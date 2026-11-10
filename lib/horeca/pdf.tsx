import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ComponentProps } from "react";
import { Document, Font, Image, Link, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import {
  formatPrice, formatSize, planCatalog, sizeLabel, templateWording,
  type CatalogCollection, type CatalogData, type CatalogProduct, type PlannedPage,
} from "./catalog";

// The one fixed template (A4 portrait), modelled on "ES – LISTA DE PRECIOS HORECA – Oct 2026.pdf".
// Nothing here is editable from the app: users change the data, never fonts, colours or positions.
// Measurements are in PDF points (A4 = 595 × 842). Fonts are open-licence stand-ins for the brand fonts
// (EB Garamond for Addington CF, Archivo for Neue Montreal / Uni Neue / Canva Sans).

export type ImageSource = { data: Buffer; format: "jpg" | "png" };
export type ImageLoader = (path: string) => Promise<ImageSource | null>;

const assets = join(process.cwd(), "lib", "horeca", "assets");
// A4 in points. Nothing may reach past the page edge: react-pdf would move it to a new page, endlessly.
const pageWidth = 595.28;
const pageHeight = 841.89;
const halfWidth = Math.floor((pageWidth / 2) * 100) / 100;
const halfHeight = Math.floor((pageHeight / 2) * 100) / 100;
const background = "#EFEDE9";
const ink = "#111111";

let fontsReady = false;
function registerFonts() {
  if (fontsReady) return;
  const font = (file: string) => join(assets, "fonts", file);
  Font.register({ family: "Garamond", fonts: [
    { src: font("EBGaramond_400Regular.ttf"), fontWeight: 400 },
    { src: font("EBGaramond_500Medium.ttf"), fontWeight: 500 },
    { src: font("EBGaramond_600SemiBold.ttf"), fontWeight: 600 },
  ] });
  Font.register({ family: "Archivo", fonts: [
    { src: font("Archivo_300Light.ttf"), fontWeight: 300 },
    { src: font("Archivo_400Regular.ttf"), fontWeight: 400 },
    { src: font("Archivo_700Bold.ttf"), fontWeight: 700 },
  ] });
  Font.register({ family: "ArchivoBlack", src: font("ArchivoBlack_400Regular.ttf") });
  // Product names and terms are short; never hyphenate them.
  Font.registerHyphenationCallback(word => [word]);
  fontsReady = true;
}

const s = StyleSheet.create({
  page: { backgroundColor: background, color: ink, fontFamily: "Archivo" },
  // Cover, collection and back pages: the logo and the titles centred around the middle of the page.
  centre: { position: "absolute", top: 380, left: 0, right: 0, alignItems: "center" },
  coverLogo: { width: 468 },
  coverTitle: { marginTop: 54, fontFamily: "Garamond", fontSize: 39, textAlign: "center" },
  coverSubtitle: { marginTop: 6, fontFamily: "Garamond", fontSize: 21, letterSpacing: 2.6, textAlign: "center" },
  backLogo: { width: 376 },
  backWebsite: { position: "absolute", top: 752, left: 0, right: 0, fontFamily: "Garamond", fontSize: 15, letterSpacing: 0.4, textAlign: "center", color: ink, textDecoration: "none" },
  // Photos and commercial terms: a 2 × 2 grid, the text in the lower-left quarter.
  quarter: { position: "absolute", width: halfWidth, height: halfHeight, objectFit: "cover" },
  termsBox: { position: "absolute", left: 0, top: halfHeight, width: halfWidth, height: halfHeight, paddingHorizontal: 18, justifyContent: "center" },
  terms: { fontFamily: "Garamond", fontWeight: 600, fontSize: 14.5, lineHeight: 1.45, letterSpacing: 0.9, textAlign: "center", marginBottom: 14 },
  // Product pages.
  headLogo: { position: "absolute", top: 32, left: 179, width: 237 },
  headLabel: { position: "absolute", top: 92, left: 26, right: 26, fontFamily: "ArchivoBlack", fontSize: 40, letterSpacing: -1.6 },
  headName: { position: "absolute", top: 140, left: 27, right: 26, fontFamily: "Archivo", fontWeight: 300, fontSize: 24, letterSpacing: 0.6 },
  headRule: { position: "absolute", top: 181, left: 26, right: 26, height: 0.8, backgroundColor: "#333333" },
  card: { position: "absolute", width: 260, height: 120 },
  cardImageBox: { position: "absolute", left: 1, top: 0, width: 97, height: 97, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  cardImage: { width: 97, height: 97, objectFit: "contain" },
  cardText: { position: "absolute", left: 105, top: 7, width: 143, height: 90 },
  cardName: { fontFamily: "Archivo", fontSize: 11.5, lineHeight: 1.38, textTransform: "uppercase", maxLines: 3, textOverflow: "ellipsis" },
  cardDetails: { position: "absolute", left: 0, right: 0, bottom: 0 },
  detailRow: { flexDirection: "row", justifyContent: "space-between", height: 12.2 },
  detailLabel: { fontFamily: "Archivo", fontWeight: 700, fontSize: 9.5 },
  detailValue: { fontFamily: "Archivo", fontSize: 9.5, textAlign: "right" },
  detailPrice: { fontFamily: "Archivo", fontWeight: 700, fontSize: 9.5, textAlign: "right" },
  cardRule: { position: "absolute", left: 0, right: 0, top: 119, height: 0.8, backgroundColor: "#333333" },
});

const rowTop = 203;
const rowPitch = 142;
const columns = [27, 309];
const centreColumn = 168;

type Ctx = { catalog: CatalogData; images: Map<string, ImageSource>; logo: ImageSource; ambiance: ImageSource[] };

function Logo({ ctx, style }: { ctx: Ctx; style: ComponentProps<typeof Image>["style"] }) {
  // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt text
  return <Image src={ctx.logo} style={style} />;
}

function Cover({ ctx }: { ctx: Ctx }) {
  return (
    <Page size="A4" style={s.page}>
      <View style={s.centre}>
        <Logo ctx={ctx} style={s.coverLogo} />
        <Text style={s.coverTitle}>{ctx.catalog.cover_title}</Text>
        {ctx.catalog.cover_subtitle ? <Text style={s.coverSubtitle}>{ctx.catalog.cover_subtitle}</Text> : null}
      </View>
    </Page>
  );
}

function Terms({ ctx, terms }: { ctx: Ctx; terms: string[] }) {
  const [a, b, c] = ctx.ambiance;
  return (
    <Page size="A4" style={s.page}>
      {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt text */}
      <Image src={a} style={{ ...s.quarter, left: 0, top: 0 }} />
      {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt text */}
      <Image src={b} style={{ ...s.quarter, left: halfWidth, top: 0 }} />
      {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt text */}
      <Image src={c} style={{ ...s.quarter, left: halfWidth, top: halfHeight }} />
      <View style={s.termsBox}>
        {terms.map((text, index) => <Text key={index} style={s.terms}>{text}</Text>)}
      </View>
    </Page>
  );
}

function CollectionTitle({ ctx, collection }: { ctx: Ctx; collection: CatalogCollection }) {
  return (
    <Page size="A4" style={s.page}>
      <View style={s.centre}>
        <Logo ctx={ctx} style={s.coverLogo} />
        {collection.label ? <Text style={s.coverTitle}>{collection.label.toUpperCase()}</Text> : null}
        <Text style={collection.label ? s.coverSubtitle : s.coverTitle}>{collection.name.toUpperCase()}</Text>
      </View>
    </Page>
  );
}

function Card({ ctx, product, left, top }: { ctx: Ctx; product: CatalogProduct; left: number; top: number }) {
  const wording = templateWording[ctx.catalog.language];
  const image = product.image_path ? ctx.images.get(product.image_path) : undefined;
  const size = formatSize(product.size_value, product.size_unit);
  return (
    <View style={{ ...s.card, left, top }} wrap={false}>
      <View style={s.cardImageBox}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt text */}
        {image ? <Image src={image} style={s.cardImage} /> : null}
      </View>
      <View style={s.cardText}>
        <Text style={s.cardName}>{product.name}</Text>
        <View style={s.cardDetails}>
          <View style={s.detailRow}><Text style={s.detailLabel}>{wording.price}</Text><Text style={s.detailPrice}>{formatPrice(product.price, product.currency ?? ctx.catalog.currency)}</Text></View>
          {size ? <View style={s.detailRow}><Text style={s.detailLabel}>{sizeLabel(product.size_unit, ctx.catalog.language)}</Text><Text style={s.detailValue}>{size}</Text></View> : null}
          {product.sku ? <View style={s.detailRow}><Text style={s.detailLabel}>{wording.code}</Text><Text style={s.detailValue}>{product.sku}</Text></View> : null}
        </View>
      </View>
      <View style={s.cardRule} />
    </View>
  );
}

function Products({ ctx, page }: { ctx: Ctx; page: Extract<PlannedPage, { kind: "products" }> }) {
  return (
    <Page size="A4" style={s.page}>
      <Logo ctx={ctx} style={s.headLogo} />
      {page.collection.label ? <Text style={s.headLabel}>{page.collection.label.toUpperCase()}</Text> : null}
      <Text style={page.collection.label ? s.headName : { ...s.headLabel }}>{page.collection.name.toUpperCase()}</Text>
      <View style={s.headRule} />
      {page.rows.map((row, rowIndex) => row.map((product, index) => (
        <Card key={product.id} ctx={ctx} product={product} top={rowTop + rowIndex * rowPitch}
          left={row.length === 1 ? centreColumn : columns[index]} />
      )))}
    </Page>
  );
}

function Back({ ctx }: { ctx: Ctx }) {
  const website = ctx.catalog.website.trim();
  const href = /^https?:\/\//i.test(website) ? website : `https://${website}`;
  return (
    <Page size="A4" style={s.page}>
      <View style={s.centre}><Logo ctx={ctx} style={s.backLogo} /></View>
      {website ? <Link src={href} style={s.backWebsite}>{website.toUpperCase()}</Link> : null}
    </Page>
  );
}

async function asset(file: string, format: ImageSource["format"]): Promise<ImageSource> {
  return { data: await readFile(join(assets, file)), format };
}

// Renders the catalog to a PDF buffer. Preview and export both call this, so they always match.
export async function renderCatalogPdf(catalog: CatalogData, loadImage: ImageLoader): Promise<Buffer> {
  registerFonts();
  const plan = planCatalog(catalog);
  const paths = new Set(plan.flatMap(page => page.kind === "products"
    ? page.rows.flat().map(product => product.image_path).filter((path): path is string => !!path) : []));
  const images = new Map<string, ImageSource>();
  await Promise.all([...paths].map(async path => {
    const image = await loadImage(path).catch(() => null);
    if (image) images.set(path, image);
  }));
  const [logo, ...ambiance] = await Promise.all([
    asset("logo.png", "png"), asset("ambiance-1.jpg", "jpg"), asset("ambiance-2.jpg", "jpg"), asset("ambiance-3.jpg", "jpg"),
  ]);
  const ctx: Ctx = { catalog, images, logo, ambiance };
  const document = (
    <Document title={catalog.title} author="Atelier Rebul" creator="BoldHub" producer="BoldHub" language={catalog.language}>
      {plan.map((page, index) => {
        if (page.kind === "cover") return <Cover key={index} ctx={ctx} />;
        if (page.kind === "terms") return <Terms key={index} ctx={ctx} terms={page.terms} />;
        if (page.kind === "collection") return <CollectionTitle key={index} ctx={ctx} collection={page.collection} />;
        if (page.kind === "products") return <Products key={index} ctx={ctx} page={page} />;
        return <Back key={index} ctx={ctx} />;
      })}
    </Document>
  );
  return renderToBuffer(document);
}
