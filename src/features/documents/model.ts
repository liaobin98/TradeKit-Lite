import {sellerFields,buyerFields,customsFields,customsRowFields,tradeOptions,paymentOptions,deliveryOptions} from '@/features/documents/reference-model';
export const types = {
  QT: ["报价单", "QUOTATION"],
  PI: ["PI", "PROFORMA INVOICE"],
  SC: ["销售合同", "SALES CONTRACT"],
  CI: ["商业发票", "COMMERCIAL INVOICE"],
  PL: ["装箱单", "PACKING LIST"],
  CD: ["报关信息", "CUSTOMS INFORMATION"],
} as const;
export type Kind = keyof typeof types;
export type Field = [string, string, string];
export const common: Field[] = [
  ["number", "单据编号", "Document No."],
  ["date", "日期", "Date"],
  ["seller", "卖方公司", "Seller"],
  ["sellerAddress", "卖方地址", "Seller address"],
  ["sellerContact", "卖方联系人 / 电话 / 邮箱", "Seller contact"],
  ["sellerPhone", "卖方电话", "Seller phone"],
  ["sellerEmail", "卖方邮箱", "Seller email"],
  ["website", "卖方官网", "Website"],
  ["taxId", "卖方税号", "Tax ID"],
  ["bankName", "银行名称", "Bank name"],
  ["bankAccount", "银行账号", "Bank account"],
  ["swift", "SWIFT", "SWIFT"],
  ["buyer", "买方公司", "Buyer"],
  ["buyerAddress", "买方地址", "Buyer address"],
  ["buyerContact", "买方联系人 / 电话 / 邮箱", "Buyer contact"],
  ["buyerPhone", "买方电话 / WhatsApp", "Buyer phone / WhatsApp"],
  ["buyerEmail", "买方邮箱", "Buyer email"],
  ["buyerCountry", "买方国家或地区", "Buyer country"],
];
export const commercial: Field[] = [
  ["currency", "币种", "Currency"],
  ["incoterm", "贸易条款", "Incoterms"],
  ["payment", "付款条款", "Payment terms"],
  ["delivery", "交期", "Delivery"],
  ["port", "装运港 / 目的港", "Ports"],
  ["freight", "运费", "Freight"],
  ["discount", "折扣金额", "Discount"],
  ["bank", "银行 / 户名 / 账号 / SWIFT", "Bank details"],
];
export const specialized: Record<Kind, Field[]> = {
  QT: [["validity", "报价有效期", "Validity"]],
  PI: [["origin", "原产国", "Country of origin"]],
  SC: [
    ["terms", "合同条款", "Contract terms"],
    ["arbitration", "争议解决", "Arbitration"],
  ],
  CI: [
    ["invoiceRef", "合同 / 订单号", "Order reference"],
    ["origin", "原产国", "Country of origin"],
    ["shipping", "运输方式 / 提单号", "Shipment / B/L"],
  ],
  PL: [
    ["invoiceRef", "发票号", "Invoice reference"],
    ["shipping", "运输方式", "Shipment"],
    ["marks", "唛头", "Shipping marks"],
    ["packing", "包装说明", "Packing"],
  ],
  CD: [
    ["declaration", "申报编号", "Declaration No."],
    ["domestic", "境内收发货人", "Domestic consignee"],
    ["transport", "运输方式", "Transport"],
    ["supervision", "监管方式", "Customs regime"],
    ["tax", "征免性质", "Tax category"],
    ["destination", "运抵国 / 指运港", "Destination"],
    ["origin", "原产国", "Origin"],
    ["marks", "唛头", "Marks"],
    ["declarationDate", "申报日期", "Declaration date"],
    ["exportPort", "出口口岸", "Export port"],
    ["destinationCountry", "目的国", "Destination country"],
    ["destinationPort", "目的港", "Destination port"],
    ["vessel", "船名 / 航班", "Vessel / Flight"],
    ["voyage", "航次", "Voyage"],
    ["billOfLading", "提单号", "Bill of lading"],
    ["tradeCountry", "贸易国", "Trading country"],
    ["totalPackages", "总件数", "Total packages"],
    ["packageType", "包装种类", "Package type"],
    ["totalGross", "总毛重", "Total gross weight"],
    ["totalNet", "总净重", "Total net weight"],
    ["totalVolume", "总体积", "Total volume"],
    ["customsNotes", "报关备注", "Customs notes"],
  ],
};
export type Row = {
  id: string;
  name: string;
  nameEn: string;
  code: string;
  packing: string;
  spec: string;
  unit: string;
  qty: string;
  price: string;
  cartons: string;
  net: string;
  gross: string;
  volume: string;
  hs: string;
  elements: string;
  origin: string;
  image: string;
};
export type Doc = {
  id?: string;
  status?: 'draft' | 'saved';
  version: 1;
  kind: Kind;
  fields: Record<string, string>;
  rows: Row[];
  language: "zh" | "en" | "both";
  theme: string;
  layout: string;
  logo: string;
  seal: string;
  notes: string;
  issued?: { via: 'excel' | 'pdf' | 'print'; at: string };
};
export function row(): Row {
  return {
    id: crypto.randomUUID(),
    name: "",
    nameEn: "",
    code: "",
    packing: "",
    spec: "",
    unit: "件 / PCS",
    qty: "",
    price: "",
    cartons: "0",
    net: "",
    gross: "",
    volume: "",
    hs: "",
    elements: "",
    origin: "",
    image: "",
  };
}
export function fresh(kind: Kind): Doc {
  return {
    version: 1,
    kind,
    fields: {
      number: `${kind}-${new Date().getFullYear()}${String(new Date().getMonth()+1).padStart(2,'0')}-${String(Date.now()).slice(-4)}`,
      date: new Date().toISOString().slice(0, 10),
      currency: "USD",
      incoterm: tradeOptions[1],
      payment: paymentOptions[1],
      delivery: deliveryOptions[1],
      freight: "",
      discount: "0",
    },
    rows: [row()],
    language: "both",
    theme: "#315f4c",
    layout: "classic",
    logo: "",
    seal: "",
    notes: "",
  };
}
export function priced(k: Kind) {
  return !!k;
}
export function fields(k: Kind) {
  return [common[0],common[1],...sellerFields,...buyerFields,['currency','币种','Currency'],['incoterm','贸易条款','Trade terms'],['payment','付款方式','Payment'],['delivery','交期','Delivery'],...(k==='PI'?[['freight','运费','Freight']]:[]),...(k==='CD'?customsFields:[])] as Field[];
}
export function columns(k: Kind): Field[] {
  return [["name","产品信息","Product"],["code","商品编码","Product code"],["spec","规格","Specification"],["qty","数量","Quantity"],["unit","单位","Unit"],["price","单价","Unit price"],...(k==='CD'?customsRowFields:[])] as Field[];
}
export function productName(r:Row,language:Doc['language']){return language==='en'?(r.nameEn||r.name):language==='zh'?(r.name||r.nameEn):[r.name,r.nameEn].filter(Boolean).join(' / ');}
