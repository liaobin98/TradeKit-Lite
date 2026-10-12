import { type Field, type Doc, type Row } from '@/features/documents/model';
export const sellerFields: Field[] = [
  ["seller", "卖方公司", "SELLER COMPANY"],
  ["sellerContact", "联系人", "CONTACT"],
  ["sellerPhone", "电话", "PHONE"],
  ["sellerEmail", "邮箱", "EMAIL"],
  ["website", "官网", "WEBSITE"],
  ["taxId", "税号", "TAX ID"],
  ["bankName", "银行名称", "BANK NAME"],
  ["bankAccount", "银行账号", "BANK ACCOUNT"],
  ["swift", "SWIFT", "SWIFT"],
  ["sellerAddress", "卖方地址", "ADDRESS"],
];
export const buyerFields: Field[] = [
  ["buyer", "买方公司", "BUYER COMPANY"],
  ["buyerContact", "联系人", "CONTACT"],
  ["buyerPhone", "电话 / WhatsApp", "PHONE"],
  ["buyerEmail", "邮箱", "EMAIL"],
  ["buyerCountry", "国家或地区", "COUNTRY / REGION"],
  ["buyerAddress", "买方地址", "ADDRESS"],
];
export const customsFields: Field[] = [
  ["declarationDate", "申报日期", "DECLARATION DATE"],
  ["supervision", "监管方式", "CUSTOMS MODE"],
  ["exportPort", "出口口岸", "EXPORT PORT"],
  ["destinationCountry", "目的国", "DESTINATION COUNTRY"],
  ["destinationPort", "目的港", "DESTINATION PORT"],
  ["transport", "运输方式", "TRANSPORT"],
  ["vessel", "船名 / 航班", "VESSEL / FLIGHT"],
  ["voyage", "航次", "VOYAGE"],
  ["billOfLading", "提单号", "B/L NO."],
  ["origin", "原产国", "ORIGIN"],
  ["tradeCountry", "贸易国", "TRADING COUNTRY"],
  ["totalPackages", "总件数", "TOTAL PACKAGES"],
  ["packageType", "包装种类", "PACKAGE TYPE"],
  ["totalGross", "总毛重", "GROSS WEIGHT"],
  ["totalNet", "总净重", "NET WEIGHT"],
  ["totalVolume", "总体积", "VOLUME"],
  ["marks", "唛头", "SHIPPING MARKS"],
  ["customsNotes", "报关备注", "CUSTOMS NOTES"],
];
export const customsRowFields: Field[] = [
  ["hs", "HS 编码", "HS CODE"],
  ["origin", "原产国", "ORIGIN"],
  ["packing", "包装", "PACKING"],
  ["net", "净重", "NET WEIGHT"],
  ["gross", "毛重", "GROSS WEIGHT"],
  ["volume", "体积 CBM", "CBM"],
];
export const currencies = ["USD", "EUR", "CNY", "GBP", "JPY", "AUD", "CAD"];
export const tradeOptions = [
  "EXW / Ex Works / 工厂交货",
  "FOB / Free On Board / 船上交货",
  "CIF / Cost, Insurance and Freight / 成本、保险加运费",
  "CFR / Cost and Freight / 成本加运费",
  "DDP / Delivered Duty Paid / 完税后交货",
];
export const paymentOptions = [
  "100% T/T in advance / 100%预付",
  "30% deposit, 70% before shipment / 30%定金，70%发货前付清",
  "30% deposit, 70% against B/L copy / 30%定金，70%见提单副本付清",
  "L/C at sight / 即期信用证",
];
export const deliveryOptions = [
  "15 days after deposit / 收到定金后15天",
  "30 days after deposit / 收到定金后30天",
  "45 days after deposit / 收到定金后45天",
  "To be confirmed / 待确认",
];
export const units = [
  "件 / PCS",
  "个 / PC",
  "套 / SET",
  "组 / GROUP",
  "双 / PAIR",
  "打 / DOZEN",
  "批 / BATCH",
  "项 / ITEM",
  "台 / UNIT",
  "辆 / VEHICLE",
  "箱 / CTN",
  "包 / PKG",
  "袋 / BAG",
  "盒 / BOX",
  "瓶 / BTL",
  "桶 / DRUM",
  "托盘 / PLT",
  "卷 / ROLL",
  "张 / SHEET",
  "片 / PIECE",
  "捆 / BUNDLE",
  "吨 / MT",
  "千克 / KG",
  "克 / G",
  "磅 / LB",
  "盎司 / OZ",
  "毫米 / MM",
  "厘米 / CM",
  "米 / M",
  "千米 / KM",
  "英寸 / IN",
  "英尺 / FT",
  "码 / YD",
  "平方米 / M²",
  "平方厘米 / CM²",
  "平方英尺 / FT²",
  "平方码 / YD²",
  "立方米 / CBM",
  "立方厘米 / CM³",
  "立方英尺 / CFT",
  "毫升 / ML",
  "升 / L",
  "加仑 / GAL",
  "小时 / HOUR",
  "天 / DAY",
  "月 / MONTH",
  "年 / YEAR",
  "千瓦时 / KWH",
];
export const unitGroups=[['数量',0,10],['包装',10,21],['重量',21,26],['长度',26,33],['面积',33,37],['体积',37,40],['容量',40,43],['时间与服务',43,48]] as const;
const presetTranslations = new Map<string, { both: string; zh: string; en: string }>();
for (const value of [...tradeOptions, ...paymentOptions, ...deliveryOptions, ...units]) {
  // Split only known presets on the bilingual separator, never T/T, B/L or custom text.
  const parts = value.split(' / ');
  const unit = units.includes(value);
  const trade = tradeOptions.includes(value);
  const entry = {
    both: value,
    zh: unit ? parts[0] : trade ? `${parts[0]} / ${parts[2]}` : parts.at(-1)!,
    en: unit ? parts[1] : parts.slice(0, -1).join(' / '),
  };
  for (const alias of [entry.both, entry.zh, entry.en]) presetTranslations.set(alias, entry);
}
export function presetText(value: string, language: Doc['language']) {
  return presetTranslations.get(value.trim())?.[language] ?? value;
}
export const themeColors=[['#315f4c','#e7f0eb','#24302b'],['#1d4e75','#e8f0f6','#1d2932'],['#30343b','#eceef0','#22252a'],['#7a263a','#f5e9ec','#331f24'],['#584077','#eee9f5','#2f2639'],['#087b78','#e4f2f1','#173534'],['#9a7428','#f7f0df','#3a3020'],['#60717c','#edf1f3','#253039'],['#344d92','#e9edf8','#202944'],['#9b382d','#f7e9e7','#3d2421']] as const;
export const customsPlaceholders:Record<string,string>={supervision:'例如：一般贸易',exportPort:'例如：宁波港',destinationCountry:'例如：德国',destinationPort:'例如：Port of Hamburg',transport:'例如：海运',vessel:'选填',voyage:'选填',billOfLading:'选填',origin:'例如：中国',tradeCountry:'例如：德国',totalPackages:'例如：120',packageType:'例如：纸箱',totalGross:'例如：1350 kg',totalNet:'例如：1200 kg',totalVolume:'例如：12.500 CBM',marks:'N/M 或实际唛头',customsNotes:'申报要素、特殊监管要求或其他备注'};
export const rowPlaceholders:Record<string,string>={hs:'海关商品编码',origin:'例如：中国',packing:'箱数或包装规格',net:'例如：120 kg',gross:'例如：135 kg',volume:'0.000'};
export function translated(d: Doc, zh: string, en: string) {
  return d.language === "zh" ? zh : d.language === "en" ? en : en + " / " + zh;
}
export function displayedName(d: Doc, r: Row) {
  return d.language === "en"
    ? r.nameEn || "Product / Service"
    : d.language === "zh"
      ? r.name || "产品 / 服务"
      : [r.nameEn || "Product / Service", r.name || "产品 / 服务"].join(" / ");
}
