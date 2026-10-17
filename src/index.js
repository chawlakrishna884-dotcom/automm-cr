import 'dotenv/config';
import express from 'express';
import {
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ChannelType,
  OverwriteType
} from 'discord.js';
import {
  createInvoice,
  paymentState,
  webhookIsValid
} from './apirone.js';
import {
  getByInvoice,
  getTrade,
  initDb,
  pool,
  updateTrade
} from './db.js';

for (const key of [
  'DISCORD_TOKEN',
  'DISCORD_CLIENT_ID',
  'DATABASE_URL',
  'PUBLIC_BASE_URL',
  'APIRONE_WEBHOOK_SECRET'
]) {
  if (!process.env[key]) {
    throw new Error(`Missing ${key}`);
  }
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

function isStaff(member) {
  return member.permissions.has(PermissionFlagsBits.ManageChannels) ||
    Boolean(process.env.STAFF_ROLE_ID && member.roles.cache.has(process.env.STAFF_ROLE_ID));
}

function accountIsOldEnough(user) {
  const requiredDays = Number(process.env.MIN_ACCOUNT_AGE_DAYS || 0);
  return Date.now() - user.createdTimestamp >= requiredDays * 86400000;
}

const commands = [
  new SlashCommandBuilder()
    .setName('ltc-create')
    .setDescription('Create a Litecoin Apirone trade invoice')
    .addUserOption(option => option.setName('seller').setDescription('Seller').setRequired(true))
    .addStringOption(option => option.setName('amount').setDescription('LTC amount').setRequired(true))
    .addStringOption(option => option.setName('item').setDescription('Item or service').setRequired(true)),
  new SlashCommandBuilder()
    .setName('ltc-info')
    .setDescription('Show Litecoin trade information')
    .addIntegerOption(option => option.setName('id').setDescription('Trade ID').setRequired(true)),
  new SlashCommandBuilder()
    .setName('ltc-release')
    .setDescription('Mark a paid trade released')
    .addIntegerOption(option => option.setName('id').setDescription('Trade ID').setRequired(true)),
  new SlashCommandBuilder()
    .setName('ltc-dispute')
    .setDescription('Open a dispute')
    .addIntegerOption(option => option.setName('id').setDescription('Trade ID').setRequired(true))
    .addStringOption(option => option.setName('reason').setDescription('Reason').setRequired(true)),
  new SlashCommandBuilder()
    .setName('ltc-cancel')
    .setDescription('Cancel an unpaid trade')
    .addIntegerOption(option => option.setName('id').setDescription('Trade ID').setRequired(true))
].map(command => command.toJSON());

function tradeDetails(trade) {
  return [
    `**Litecoin Trade #${trade.id}**`,
    `Status: **${trade.status}**`,
    `Buyer: <@${trade.buyer_id}>`,
    `Seller: <@${trade.seller_id}>`,
    `Amount: **${trade.amount_display} LTC**`,
    `Payment address: \`${trade.payment_address || 'see invoice'}\``,
    trade.payment_url ? `Payment page: ${trade.payment_url}` : '',
    trade.payment_txid ? `TXID: \`${trade.payment_txid}\`` : ''
  ].filter(Boolean).join('\n');
}

async function notifyTrade(trade, message) {
  if (!trade.channel_id) return;
  const channel = await client.channels.fetch(trade.channel_id).catch(() => null);
  if (channel?.isTextBased()) {
    await channel.send(message);
  }
}

async function start() {
  await initDb();

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const route = process.env.DISCORD_GUILD_ID
    ? Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID)
    : Routes.applicationCommands(process.env.DISCORD_CLIENT_ID);

  await rest.put(route, { body: commands });

  client.once('ready', () => {
    console.log(`Apirone Litecoin bot online as ${client.user.tag}`);
  });

  client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand() || !interaction.guild) return;

    try {
      if (interaction.commandName === 'ltc-create') {
        const seller = interaction.options.getUser('seller', true);
        const amount = interaction.options.getString('amount', true);
        const item = interaction.options.getString('item', true).slice(0, 500);

        if (seller.bot || seller.id === interaction.user.id) {
          throw new Error('Seller must be another human user.');
        }

        if (!accountIsOldEnough(interaction.user) || !accountIsOldEnough(seller)) {
          throw new Error('A participant account is too new.');
        }

        const validAmount = /^[0-9]+([.][0-9]{1,8})?$/.test(amount);
        if (!validAmount || Number(amount) <= 0) {
          throw new Error('Enter a valid positive LTC amount with up to 8 decimals.');
        }

        const inserted = await pool.query(
          'INSERT INTO crypto_trades (guild_id, buyer_id, seller_id, amount_display, item_description, invoice_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
          [interaction.guild.id, interaction.user.id, seller.id, amount, item, `pending-${Date.now()}-${interaction.user.id}`]
        );

        const provisional = inserted.rows[0];
        const invoice = await createInvoice({
          tradeId: provisional.id,
          amount,
          description: item
        });

        await updateTrade(provisional.id, {
          invoice_id: invoice.id,
          payment_url: invoice.payUrl,
          payment_address: invoice.address,
          expires_at: new Date(Date.now() + Number(process.env.INVOICE_LIFETIME_SECONDS || 3600) * 1000)
        });

        const trade = await getTrade(provisional.id, interaction.guild.id);
        const channel = await interaction.guild.channels.create({
          name: `ltc-trade-${trade.id}`,
          type: ChannelType.GuildText,
          permissionOverwrites: [
            {
              id: interaction.guild.roles.everyone.id,
              type: OverwriteType.Role,
              deny: [PermissionFlagsBits.ViewChannel]
            },
            {
              id: interaction.user.id,
              type: OverwriteType.Member,
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
            },
            {
              id: seller.id,
              type: OverwriteType.Member,
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
            },
            ...(process.env.STAFF_ROLE_ID ? [{
              id: process.env.STAFF_ROLE_ID,
              type: OverwriteType.Role,
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
            }] : [])
          ]
        });

        await updateTrade(trade.id, { channel_id: channel.id });
        const finalTrade = await getTrade(trade.id, interaction.guild.id);

        return interaction.reply({
          content: `Created ${channel}.\n${tradeDetails(finalTrade)}\n\n**Non-custodial:** Apirone processes the payment; this bot never stores private keys or controls funds.`,
          ephemeral: true
        });
      }

      const trade = await getTrade(
        interaction.options.getInteger('id', true),
        interaction.guild.id
      );

      if (!trade) throw new Error('Trade not found.');

      if (![trade.buyer_id, trade.seller_id].includes(interaction.user.id) && !isStaff(interaction.member)) {
        throw new Error('You are not a participant or staff member.');
      }

      if (interaction.commandName === 'ltc-info') {
        return interaction.reply({ content: tradeDetails(trade), ephemeral: true });
      }

      if (interaction.commandName === 'ltc-release') {
        if (interaction.user.id !== trade.seller_id && !isStaff(interaction.member)) {
          throw new Error('Only the seller or staff can release.');
        }
        if (trade.status !== 'paid') {
          throw new Error('The invoice is not marked paid yet.');
        }
        await updateTrade(trade.id, { status: 'released' });
        return interaction.reply(`Trade #${trade.id} marked **released**.`);
      }

      if (interaction.commandName === 'ltc-dispute') {
        await updateTrade(trade.id, {
          status: 'disputed',
          dispute_reason: interaction.options.getString('reason', true).slice(0, 1000)
        });
        return interaction.reply(`Trade #${trade.id} is **disputed**. Staff must review it.`);
      }

      if (interaction.commandName === 'ltc-cancel') {
        if (!['awaiting_payment', 'payment_pending'].includes(trade.status)) {
          throw new Error('Only unpaid trades can be cancelled.');
        }
        await updateTrade(trade.id, { status: 'cancelled' });
        return interaction.reply(`Trade #${trade.id} cancelled.`);
      }
    } catch (error) {
      console.error(error);
      const message = String(error.message || 'Request failed').slice(0, 1900);
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: message, ephemeral: true });
      } else {
        await interaction.reply({ content: message, ephemeral: true });
      }
    }
  });

  const app = express();
  app.use(express.json());
  app.get('/', (_request, response) => response.status(200).send('Apirone Litecoin Discord bot online.'));

  app.post('/webhooks/apirone', async (request, response) => {
    try {
      if (!webhookIsValid(request)) return response.status(401).send('invalid webhook');

      const payment = paymentState(request.body);
      const trade = await getByInvoice(payment.invoiceId);
      if (!trade) return response.status(404).send('unknown invoice');

      const paid = ['paid', 'confirmed', 'completed', 'success'].includes(payment.status);
      const failed = ['expired', 'cancelled', 'failed'].includes(payment.status);

      if (paid) {
        await updateTrade(trade.id, {
          status: 'paid',
          payment_txid: payment.txid
        });
        const freshTrade = await getByInvoice(payment.invoiceId);
        await notifyTrade(
          freshTrade,
          `âœ… **Litecoin payment confirmed by Apirone.**\n${tradeDetails(freshTrade)}\nSeller may now deliver. The bot cannot reverse blockchain payments.`
        );
      } else if (failed) {
        await updateTrade(trade.id, { status: 'expired' });
      } else if (payment.status) {
        await updateTrade(trade.id, { status: 'payment_pending' });
      }

      return response.send('ok');
    } catch (error) {
      console.error(error);
      return response.status(500).send('error');
    }
  });

  app.listen(process.env.PORT || 3000, '0.0.0.0');
  await client.login(process.env.DISCORD_TOKEN);
}

start().catch(error => {
  console.error(error);
  process.exit(1);
});
