require("dotenv").config();

const {
  Client, GatewayIntentBits, REST, Routes,
  SlashCommandBuilder, PermissionFlagsBits,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ChannelType, PermissionsBitField
} = require("discord.js");
const { readProducts, writeProducts, nextId } = require("./store");

const required = ["DISCORD_TOKEN", "CLIENT_ID", "GUILD_ID"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Configuração ausente no .env: ${key}`);
    process.exit(1);
  }
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const money = (value) => `R$ ${Number(value).toFixed(2).replace(".", ",")}`;
const isAdmin = (member) =>
  member.permissions.has(PermissionsBitField.Flags.Administrator) ||
  (process.env.ADMIN_ROLE_ID && member.roles.cache.has(process.env.ADMIN_ROLE_ID));
const isSeller = (member) =>
  isAdmin(member) ||
  (process.env.SELLER_ROLE_ID && member.roles.cache.has(process.env.SELLER_ROLE_ID));

const commands = [
  new SlashCommandBuilder()
    .setName("produto")
    .setDescription("Gerencia os produtos da loja")
    .addSubcommand(s => s.setName("adicionar").setDescription("Adiciona um produto")
      .addStringOption(o => o.setName("nome").setDescription("Nome do produto").setRequired(true))
      .addStringOption(o => o.setName("descricao").setDescription("Descrição").setRequired(true))
      .addNumberOption(o => o.setName("preco").setDescription("Preço em reais").setRequired(true).setMinValue(0))
      .addIntegerOption(o => o.setName("estoque").setDescription("Quantidade disponível").setRequired(true).setMinValue(0))
      .addStringOption(o => o.setName("banner").setDescription("URL https:// da imagem (opcional)")))
    .addSubcommand(s => s.setName("editar").setDescription("Edita um produto existente")
      .addStringOption(o => o.setName("id").setDescription("ID do produto").setRequired(true))
      .addStringOption(o => o.setName("nome").setDescription("Novo nome"))
      .addStringOption(o => o.setName("descricao").setDescription("Nova descrição"))
      .addNumberOption(o => o.setName("preco").setDescription("Novo preço").setMinValue(0))
      .addIntegerOption(o => o.setName("estoque").setDescription("Novo estoque").setMinValue(0))
      .addStringOption(o => o.setName("banner").setDescription("Nova URL do banner")))
    .addSubcommand(s => s.setName("remover").setDescription("Remove um produto")
      .addStringOption(o => o.setName("id").setDescription("ID do produto").setRequired(true))),
  new SlashCommandBuilder()
    .setName("loja")
    .setDescription("Publica a vitrine da loja")
    .addSubcommand(s => s.setName("publicar").setDescription("Publica/atualiza a loja neste canal")),
  new SlashCommandBuilder()
    .setName("produtos")
    .setDescription("Mostra os produtos cadastrados")
].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
  console.log("Comandos do servidor registrados.");
}

function productEmbed(product) {
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(product.name)
    .setDescription(product.description)
    .addFields(
      { name: "Preço", value: money(product.price), inline: true },
      { name: "Estoque", value: String(product.stock), inline: true },
      { name: "Entrega", value: "⚡ Entrega Manual!", inline: false },
      { name: "Código", value: `#${product.id}`, inline: true }
    )
    .setFooter({ text: "GH VENDAS • Atendimento manual" });
  if (product.banner && /^https:\/\/\S+/i.test(product.banner)) embed.setImage(product.banner);
  return embed;
}

function shopRows(product) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`buy:${product.id}`)
      .setLabel("Comprar")
      .setStyle(ButtonStyle.Success)
      .setDisabled(product.stock <= 0)
  )];
}

async function createOrder(interaction, product) {
  if (!product || product.stock <= 0) {
    return interaction.reply({ content: "Esse produto está sem estoque no momento.", ephemeral: true });
  }
  const guild = interaction.guild;
  const categoryId = process.env.TICKET_CATEGORY_ID;
  const safeName = interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 12) || "cliente";
  const channel = await guild.channels.create({
    name: `pedido-${safeName}-${product.id}`.slice(0, 90),
    type: ChannelType.GuildText,
    parent: categoryId || undefined,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
      { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] }
    ]
  });

  const sellerRole = process.env.SELLER_ROLE_ID;
  if (sellerRole) {
    await channel.permissionOverwrites.edit(sellerRole, {
      ViewChannel: true, SendMessages: true, ReadMessageHistory: true
    });
  }

  const embed = new EmbedBuilder()
    .setColor(0xF1C40F)
    .setTitle("Novo pedido • GH VENDAS")
    .setDescription(`Cliente: ${interaction.user}\nProduto: **${product.name}**\nPreço: **${money(product.price)}**\n\nUm vendedor irá assumir este atendimento. Não faça pagamento antes de receber a confirmação e os dados PIX neste canal.`)
    .setFooter({ text: `Produto #${product.id} • Entrega manual` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`claim:${product.id}:${interaction.user.id}`).setLabel("Assumir pedido").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("close-order").setLabel("Fechar pedido").setStyle(ButtonStyle.Secondary)
  );

  await channel.send({ content: `${interaction.user}${sellerRole ? ` <@&${sellerRole}>` : ""}`, embeds: [embed], components: [row] });
  await interaction.reply({ content: `Seu pedido foi aberto: ${channel}`, ephemeral: true });
}

client.once("ready", async () => {
  console.log(`GH VENDAS online como ${client.user.tag}`);
  try { await registerCommands(); }
  catch (error) { console.error("Erro ao registrar comandos:", error); }
});

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "produto") {
        if (!isAdmin(interaction.member)) return interaction.reply({ content: "Somente a administração pode gerenciar produtos.", ephemeral: true });
        const sub = interaction.options.getSubcommand();
        const products = readProducts();

        if (sub === "adicionar") {
          const name = interaction.options.getString("nome");
          const description = interaction.options.getString("descricao");
          const price = interaction.options.getNumber("preco");
          const stock = interaction.options.getInteger("estoque");
          const banner = interaction.options.getString("banner");
          if (banner && !/^https:\/\/\S+/i.test(banner)) return interaction.reply({ content: "O banner precisa ser um link HTTPS válido.", ephemeral: true });
          const product = { id: nextId(products), name, description, price, stock, banner: banner || "" };
          products.push(product); writeProducts(products);
          return interaction.reply({ content: `Produto **${name}** cadastrado com ID **${product.id}**.`, ephemeral: true });
        }

        const id = interaction.options.getString("id");
        const index = products.findIndex(p => p.id === id);
        if (index < 0) return interaction.reply({ content: "Não encontrei esse ID de produto.", ephemeral: true });

        if (sub === "remover") {
          const [removed] = products.splice(index, 1); writeProducts(products);
          return interaction.reply({ content: `Produto **${removed.name}** removido.`, ephemeral: true });
        }

        const fields = ["nome", "descricao", "preco", "estoque", "banner"];
        const keys = ["name", "description", "price", "stock", "banner"];
        fields.forEach((field, i) => {
          const value = interaction.options.get(field);
          if (value !== null) products[index][keys[i]] = value.value;
        });
        if (products[index].banner && !/^https:\/\/\S+/i.test(products[index].banner)) {
          return interaction.reply({ content: "O banner precisa ser um link HTTPS válido. Nenhuma alteração foi salva.", ephemeral: true });
        }
        writeProducts(products);
        return interaction.reply({ content: `Produto **${products[index].name}** atualizado. Para atualizar a vitrine, publique /loja publicar novamente.`, ephemeral: true });
      }

      if (interaction.commandName === "produtos") {
        const products = readProducts();
        if (!products.length) return interaction.reply({ content: "Ainda não há produtos cadastrados.", ephemeral: true });
        return interaction.reply({ content: products.map(p => `**#${p.id} — ${p.name}** • ${money(p.price)} • Estoque: ${p.stock}`).join("\n"), ephemeral: true });
      }

      if (interaction.commandName === "loja") {
        if (!isAdmin(interaction.member)) return interaction.reply({ content: "Somente a administração pode publicar a loja.", ephemeral: true });
        const products = readProducts();
        if (!products.length) return interaction.reply({ content: "Cadastre pelo menos um produto com /produto adicionar.", ephemeral: true });
        await interaction.reply({ content: "Publicando os produtos...", ephemeral: true });
        for (const product of products) {
          await interaction.channel.send({ embeds: [productEmbed(product)], components: shopRows(product) });
        }
        return;
      }
    }

    if (interaction.isButton()) {
      const [action, id, buyerId] = interaction.customId.split(":");

      if (action === "buy") {
        const product = readProducts().find(p => p.id === id);
        return createOrder(interaction, product);
      }

      if (action === "claim") {
        if (!isSeller(interaction.member)) return interaction.reply({ content: "Somente um vendedor autorizado pode assumir este pedido.", ephemeral: true });
        const buyer = await interaction.guild.members.fetch(buyerId).catch(() => null);
        if (buyer) await interaction.channel.permissionOverwrites.edit(buyer.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
        const pix = process.env.PIX_KEY;
        const pixText = pix
          ? `\n\n**Dados PIX**\nChave: \`${pix}\`\nRecebedor: **${process.env.PIX_NAME || "Não informado"}**\n${process.env.PIX_INFO || ""}\n\nConfira o valor e o recebedor antes de concluir qualquer pagamento.`
          : "\n\nA chave PIX ainda não foi configurada pelo responsável da loja.";
        await interaction.reply({ content: `Pedido assumido por ${interaction.user}.${pixText}`, allowedMentions: { users: [] } });
        return;
      }

      if (action === "close-order") {
        if (!isSeller(interaction.member) && interaction.user.id !== interaction.channel.topic) {
          // O fechamento também pode ser feito pela administração ou vendedor.
          if (!isAdmin(interaction.member)) return interaction.reply({ content: "Somente um vendedor pode fechar este canal.", ephemeral: true });
        }
        await interaction.reply({ content: "Este pedido será fechado em alguns segundos." });
        setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
      }
    }
  } catch (error) {
    console.error(error);
    const payload = { content: "Ocorreu um erro. Confira o console e as configurações do bot.", ephemeral: true };
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) await interaction.reply(payload).catch(() => {});
  }
});

client.login(process.env.DISCORD_TOKEN);
