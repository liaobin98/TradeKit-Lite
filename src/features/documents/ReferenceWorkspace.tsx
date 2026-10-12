import { Fragment, useRef } from "react";
import {
  BrainCircuit,
  Palette,
  PanelsTopLeft,
  Plus,
  Trash2,
  Copy,
  ImagePlus,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ComboboxField, SelectField, FilePicker, Disclosure } from "@/components/controls";
import { types, row, productName, type Doc, type Row } from '@/features/documents/model';
import { layouts, themes } from '@/features/documents/presentation';
import { amount, totals } from '@/features/documents/calculations';
import {
  sellerFields,
  buyerFields,
  customsFields,
  customsRowFields,
  currencies,
  tradeOptions,
  paymentOptions,
  deliveryOptions,
  units,
  translated,
  presetText,
  displayedName,
  unitGroups, customsPlaceholders, rowPlaceholders, themeColors,
} from "@/features/documents/reference-model";
import { NumericInput } from '@/components/NumericInput';
import { numeric, type ValidationIssue } from '@/features/documents/validation';
import { CatalogLookupInput } from '@/features/catalogs/CatalogLookupInput';
import { applyCatalogSelection, type CatalogSelection } from '@/features/catalogs/catalog-lookup';
import { copyProductRow, removeProductRow, needsProductRemovalConfirmation } from '@/features/documents/product-rows';
import { ProductRowDelete } from '@/features/documents/ProductRowDelete';
type Props = {
  doc: Doc;
  setDoc: React.Dispatch<React.SetStateAction<Doc>>;
  image: (file: File | undefined, key: string) => void;
  text: string;
  setText: (v: string) => void;
  busy: boolean;
  ai: boolean;
  aiRequiresToken: boolean;
  aiToken: string;
  setAiToken: (v: string) => void;
  consent: boolean;
  setConsent: (v: boolean) => void;
  parse: (remote: boolean) => void;
  candidate: any;
  applyCandidate: () => void;
  issues: ValidationIssue[];
};
function UnitField({
  value,
  language,
  onChange,
  disabled,
}: {
  value: string;
  language: Doc['language'];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
      <ComboboxField
        label="产品单位"
        value={value}
        displayValue={presetText(value, language)}
        disabled={disabled}
        options={unitGroups.flatMap(([group,start,end])=>units.slice(start,end).map(u=>({value:u,label:presetText(u,language),group})))}
        onValueChange={onChange}
      />
  );
}
export function ReferenceWorkspace(p: Props) {
  const { doc: d, setDoc } = p;
  const disabled = p.busy;
  const productTable = useRef<HTMLDivElement>(null);
  const issue = (path: string) => p.issues.find(i => i.path === path);
  const numericalFields = ['totalPackages', 'totalNet', 'totalGross', 'totalVolume'];
  const update = (key: string, value: string) =>
    setDoc((v) => ({ ...v, fields: { ...v.fields, [key]: value } }));
  const updateRow = (id: string, key: string, value: string) =>
    setDoc((v) => ({
      ...v,
      rows: v.rows.map((r) => (r.id === id ? { ...r, [key]: value } : r)),
    }));
  const selectCatalog = (selection: CatalogSelection, rowId?: string) => {
    const result = applyCatalogSelection(d, selection, rowId);
    setDoc(result.document);
    return result.warning;
  };
  const field = (k: string, cn: string) => k === 'seller' || k === 'buyer' ? (
    <CatalogLookupInput key={k} category={k === 'seller' ? 'sellers' : 'buyers'} label={cn} showLabel value={d.fields[k] || ''} onChange={value => update(k, value)} onSelect={selection => selectCatalog(selection)} disabled={disabled} />
  ) : (
    <label key={k} className={k.endsWith("Address")||k==='customsNotes' ? "span-full" : ""}>
      {cn}
      {numericalFields.includes(k) ? <NumericInput label={cn} value={d.fields[k] || ''} onChange={v => update(k,v)} issue={issue('fields.' + k)} placeholder={customsPlaceholders[k]} hint={['totalNet','totalGross'].includes(k)?'不带单位按 kg；支持 kg/g/t/lb/oz':undefined}/> : k === "customsNotes" ? (
        <Textarea
          rows={3}
          placeholder={customsPlaceholders[k]}
          value={d.fields[k] || ""}
          onChange={(e) => update(k, e.target.value)}
        />
      ) : (
        <Input
          type={k === "declarationDate" ? "date" : "text"}
          aria-label={k.startsWith('seller')&&!cn.startsWith('卖方')?'卖方'+cn:k.startsWith('buyer')&&!cn.startsWith('买方')?'买方'+cn:cn}
          placeholder={d.kind==='CD'?customsPlaceholders[k]:undefined}
          value={d.fields[k] || ""}
          onChange={(e) => update(k, e.target.value)}
        />
      )}
    </label>
  );
  return (
    <div className="editor-layout reference-workspace">
      <fieldset className="editor" disabled={disabled}>
        <section className="design-picker panel">
          <label>
            <PanelsTopLeft size={14} />
            单据款式
            <SelectField
              disabled={disabled}
              label="单据款式"
              value={d.layout}
              options={layouts
                .filter(([v]) => v !== "compact")
                .map(([value, label]) => ({ value, label }))}
              onValueChange={(layout) => setDoc((v) => ({ ...v, layout }))}
            />
          </label>
          <label>
            <Palette size={14} />
            主题颜色
            <SelectField
              disabled={disabled}
              label="主题颜色"
              value={d.theme}
              options={[
                ...themes.map(([label, value]) => ({ value, label })),
                ...(!themes.some((t) => t[1] === d.theme)
                  ? [{ value: d.theme, label: "已保存的自定义主题" }]
                  : []),
              ]}
              onValueChange={(theme) => setDoc((v) => ({ ...v, theme }))}
            />
          </label>
          <label>
            单据语言
            <SelectField
              disabled={disabled}
              label="单据语言"
              value={d.language}
              options={[
                { value: "both", label: "中英双语" },
                { value: "en", label: "纯英文" },
                { value: "zh", label: "纯中文" },
              ]}
              onValueChange={(language) =>
                setDoc((v) => ({ ...v, language: language as Doc["language"] }))
              }
            />
          </label>
        </section>
        <Disclosure title="AI 识别/填写" subtitle="直接粘贴聊天、WhatsApp、询盘、邮件、订单文字或产品清单">
          <Textarea
            aria-label="待识别业务内容"
            rows={5}
            maxLength={20000}
            placeholder="无需整理格式，原文直接粘贴到这里"
            value={p.text}
            onChange={(e) => p.setText(e.target.value)}
          />
          <div className="ai-actions">
            <span>资料不全也会填写已识别内容</span>
            <Button
              variant="default"
              disabled={disabled || !p.text.trim() || !p.ai || !p.consent || (p.aiRequiresToken && !p.aiToken.trim())}
              onClick={() => p.parse(true)}
            >
              <BrainCircuit size={17} />
              开始 AI 识别
            </Button>
          </div>
          <p className="integration-note">
            {p.ai
              ? "调用前请确认：内容将发送到所配置模型服务。"
              : "AI 未配置；本地规则解析可用（不发送内容，不是 AI 结果）。"}
          </p>
          {p.ai && p.aiRequiresToken && (
            <div>
              <label htmlFor="ai-access-token">AI 访问口令</label>
              <Input
                id="ai-access-token"
                type="password"
                autoComplete="off"
                maxLength={512}
                value={p.aiToken}
                onChange={(e) => p.setAiToken(e.target.value)}
                aria-describedby="ai-access-token-help"
                placeholder="填写管理员提供的访问口令"
              />
              <p id="ai-access-token-help" className="integration-note">
                在线识别需填写口令并同意发送内容。口令仅保留在当前页面内存，刷新后清除；不是模型 API 密钥。
              </p>
            </div>
          )}
          {p.ai && (
            <label className="consent">
              <Checkbox
                aria-label="同意发送内容到模型服务"
                checked={p.consent}
                onCheckedChange={(v) => p.setConsent(v === true)}
              />{" "}
              我同意发送以上内容
            </label>
          )}
          <Button
            disabled={disabled || !p.text.trim()}
            onClick={() => p.parse(false)}
          >
            本地规则解析
          </Button>
          {p.candidate && (
            <div>
              <h3>{p.candidate.source}</h3>
              <pre>{JSON.stringify(p.candidate, null, 2)}</pre>
              <Button onClick={p.applyCandidate}>确认应用结构化结果</Button>
            </div>
          )}
        </Disclosure>
        <section className="panel party-editor">
          <div className="panel-title">
            <div>
              <h3>卖方资料</h3>
              <p>可检索已有卖方资料，选中后带入；也可直接手动填写。</p>
            </div>
            <div className="logo-editor-actions">
              <FilePicker
                label="上传企业 Logo"
                text={d.logo ? "更换企业 Logo" : "上传企业 Logo"}
                accept="image/*"
                onFile={(file) => p.image(file, "logo")}
              />
              {d.logo && <Button
                disabled={disabled}
                aria-label="删除企业 Logo"
                onClick={() => setDoc(v => ({ ...v, logo: "" }))}
              ><Trash2 size={16} aria-hidden="true" />删除 Logo</Button>}
            </div>
          </div>
          <div className="reference-fields">
            {sellerFields.map(([k, cn]) => field(k, cn))}
          </div>
        </section>
        <section className="panel party-editor">
          <div className="panel-title">
            <div>
              <h3>买方资料</h3>
              <p>可检索已有买方资料，未选中则继续手动填写。</p>
            </div>
          </div>
          <div className="reference-fields">
            {buyerFields.filter(([k])=>k!=='buyerAddress').map(([k, cn]) => field(k, cn))}
            <label>
              币种
              <SelectField
                disabled={disabled}
                label="币种"
                value={d.fields.currency || "USD"}
                options={currencies.map((value) => ({ value, label: value }))}
                onValueChange={(v) => update("currency", v)}
              />
            </label>
            {field('buyerAddress','买方地址')}
            <ComboboxField
              showLabel
              disabled={disabled}
              label="贸易条款"
              value={d.fields.incoterm || ""}
              displayValue={presetText(d.fields.incoterm || '', d.language)}
              options={tradeOptions.map((value) => ({ value, label: presetText(value, d.language) }))}
              onValueChange={(v) => update("incoterm", v)}
            />
            <ComboboxField
              showLabel
              disabled={disabled}
              label="付款方式"
              value={d.fields.payment || ""}
              displayValue={presetText(d.fields.payment || '', d.language)}
              options={paymentOptions.map((value) => ({ value, label: presetText(value, d.language) }))}
              onValueChange={(v) => update("payment", v)}
            />
            <ComboboxField
              showLabel
              disabled={disabled}
              label="交期"
              value={d.fields.delivery || ""}
              displayValue={presetText(d.fields.delivery || '', d.language)}
              options={deliveryOptions.map((value) => ({ value, label: presetText(value, d.language) }))}
              onValueChange={(v) => update("delivery", v)}
            />
          </div>
        </section>
        <section className="panel product-editor">
          <div className="panel-title">
            <div><h3>产品明细</h3><p>未填完整项目不计入合计；错误数值须修正后导出，仍可保存草稿。</p></div>
            <span>合计 {d.fields.currency} {totals(d).subtotal}</span>
          </div>
          <div ref={productTable} className="product-table-scroll">
            <table className="product-editor-table">
              <thead>
                <tr>
                  {[
                    "产品 / 服务",
                    "规格",
                    "数量",
                    "单位",
                    "单价",
                    "金额",
                  ].map((s) => (
                    <th key={s}>{s}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r, i) => (
                  <Fragment key={r.id}><tr>
                    <td>
                      <div className="product-identity"><div className="product-image-input">
                      <div className="product-image-preview">
                      {r.image ? (
                        <>
                          <img src={r.image} alt={`产品 ${i + 1}`} />
                          <Button
                            className="product-image-remove"
                            variant="outline"
                            size="icon"
                            disabled={disabled}
                            onClick={() => updateRow(r.id, "image", "")}
                            aria-label={`删除产品 ${i + 1} 图片`}
                            title="删除图片"
                          >
                            <X size={12} aria-hidden="true" />
                          </Button>
                        </>
                      ) : (
                        <ImagePlus size={24} />
                      )}
                      </div>
                      <FilePicker
                        label={`上传产品 ${i + 1} 图片`}
                        text={r.image?'换图':'上传图片'}
                        onFile={(f) => p.image(f, r.id)}
                      />
                      <div className="product-row-actions" role="group" aria-label={`产品 ${i + 1} 操作`}>
                        <ProductRowDelete
                          number={i + 1}
                          disabled={disabled}
                          needsConfirmation={needsProductRemovalConfirmation(r)}
                          onRemove={() => setDoc(v => ({ ...v, rows: removeProductRow(v.rows, r.id) }))}
                          onRemovedFocus={() => productTable.current?.querySelector<HTMLInputElement>('.product-names-input input')?.focus({ preventScroll: true })}
                        />
                        <Button
                          size="icon"
                          disabled={disabled}
                          aria-label={`复制产品 ${i + 1}`}
                          title="复制为新产品"
                          onClick={() => setDoc(v => ({ ...v, rows: copyProductRow(v.rows, r.id) }))}
                        ><Copy size={14} aria-hidden="true" /></Button>
                      </div>
                      </div><div className="product-names-input">
                      <CatalogLookupInput
                        category="products"
                        label={`产品 ${i + 1} 中文标题`}
                        placeholder="中文标题"
                        value={r.name}
                        onChange={value => updateRow(r.id, 'name', value)}
                        onSelect={selection => selectCatalog(selection, r.id)}
                        disabled={disabled}
                      />
                      <Input
                        aria-label={`产品 ${i + 1} English title`}
                        placeholder="English title"
                        value={r.nameEn}
                        onChange={(e) =>
                          updateRow(r.id, "nameEn", e.target.value)
                        }
                      />
                      <Input
                        aria-label={`产品 ${i + 1} 商品编码`}
                        placeholder="商品编码"
                        value={r.code}
                        onChange={(e) =>
                          updateRow(r.id, "code", e.target.value)
                        }
                      />
                      </div></div></td><td><Input
                        aria-label={`产品 ${i + 1} 规格`}
                        placeholder="型号、尺寸、材质"
                        value={r.spec}
                        onChange={(e) =>
                          updateRow(r.id, "spec", e.target.value)
                        }
                      />
                    </td>
                    <td>
                      <NumericInput
                        label={`产品 ${i + 1} 数量`}
                        placeholder="0"
                        issue={issue(`rows.${r.id}.qty`)}
                        value={r.qty}
                        onChange={v => updateRow(r.id, "qty", v)}
                      />
                    </td>
                    <td>
                      <UnitField
                        disabled={disabled}
                        value={r.unit}
                        language={d.language}
                        onChange={(v) => updateRow(r.id, "unit", v)}
                      />
                    </td>
                    <td>
                      <NumericInput
                        label={`产品 ${i + 1} 单价`}
                        placeholder="0.00"
                        issue={issue(`rows.${r.id}.price`)}
                        value={r.price}
                        onChange={v => updateRow(r.id, 'price', v)}
                      />
                    </td>
                    <td>{amount(r) || '—'}</td>
                  </tr>{d.kind==='CD'&&<tr className="customs-line"><td colSpan={6}><div className="customs-row-fields">{customsRowFields.map(([k,cn])=><label key={k}>{cn}{['net','gross','volume'].includes(k)?<NumericInput label={`产品 ${i+1} ${cn}`} issue={issue(`rows.${r.id}.${k}`)} placeholder={rowPlaceholders[k]} value={r[k as keyof Row]} onChange={v=>updateRow(r.id,k,v)}/>:<Input aria-label={`产品 ${i+1} ${cn}`} placeholder={rowPlaceholders[k]} value={r[k as keyof Row]} onChange={e=>updateRow(r.id,k,e.target.value)}/>}</label>)}</div><p className="field-help">重量不带单位按 kg；支持 kg/g/t/lb/oz，体积使用 CBM / m³。</p></td></tr>}</Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <Button
            onClick={() => setDoc((v) => ({ ...v, rows: [...v.rows, row()] }))}
          >
            <Plus size={15} />
            添加产品明细
          </Button>
        </section>
        {d.kind==='PI'&&<section className="panel fee-editor"><div className="panel-title"><div><h3>费用与合计</h3><p>运费将计入 PI 最终金额</p></div></div><div className="reference-fields"><label>产品金额<output>{d.fields.currency} {totals(d).subtotal}</output></label><label className="freight-field">运费<NumericInput label="运费" placeholder="0.00" issue={issue('fields.freight')} value={d.fields.freight||''} onChange={v=>update('freight',v)}/></label><label>PI 总金额<output>{d.fields.currency} {totals(d).total}</output></label></div></section>}
        {d.kind === "CD" && (
          <section className="panel customs-editor">
            <div className="panel-title">
              <div>
                <h3>报关信息</h3>
                <p>字段可选填；所有填写内容进入预览与导出，错误数值需修正后导出。</p>
              </div>
            </div>
            <div className="reference-fields">
              {customsFields.map(([k, cn]) => field(k, cn))}
            </div>
          </section>
        )}
        <section className="panel remarks-editor"><h3>补充说明</h3><Textarea aria-label="补充说明" rows={3} value={d.notes} onChange={e=>setDoc(v=>({...v,notes:e.target.value}))}/></section>
      </fieldset>
      <ReferencePreview doc={d} />
    </div>
  );
}
export function ReferencePreview({ doc: d }: { doc: Doc }) {
  const colors=themeColors.find(c=>c[0]===d.theme)||[d.theme,'#e7f0eb','#24302b'];
  const frame='#'+[1,3,5].map(i=>Math.round(parseInt(colors[0].slice(i,i+2),16)*.35+255*.65).toString(16).padStart(2,'0')).join('');
  const t = (zh: string, en: string) => translated(d, zh, en);
  const stackedHeading = (zh: string, en: string) => d.language === 'both' ? (
    <><span className="preview-header-line" lang="en">{en}</span><span className="preview-header-line" lang="zh-CN">{zh}</span></>
  ) : t(zh, en);
  const f = d.fields;
  const money = (value: string, precise = false) => { const result = numeric(value || ''); return result.state === 'valid' ? result.value.toFixed(precise ? Math.max(2, result.value.decimalPlaces()) : 2) : '—'; };
  const party = (seller: boolean) => (
    <section className="preview-party">
      <h3>{t(seller ? "卖方" : "买方", seller ? "SELLER" : "BUYER")}</h3>
      <strong data-field={seller?'seller':'buyer'}>{f[seller ? "seller" : "buyer"] || "--"}</strong>
      <div>
        {(seller
          ? ["sellerContact", "sellerAddress", "sellerPhone", "sellerEmail", "taxId"]
          : ["buyerContact", "buyerAddress", "buyerPhone", "buyerEmail", "buyerCountry"]
        ).map((k) => (
          <p key={k} data-field={k}>
            <b>
              {(() => {const field = [...sellerFields,...buyerFields].find(v=>v[0]===k)!;return t(field[1],field[2]);})()}
            </b>
            : {f[k] || "--"}
          </p>
        ))}
      </div>
    </section>
  );
  return (
    <section className="preview reference-preview">
      <article
        className={"paper " + d.layout}
        style={{ "--accent": colors[0],'--accent-soft':colors[1],'--ink':colors[2],'--accent-frame':frame } as React.CSSProperties}
      >
        <div className="preview-letterhead">
          <div className="preview-company"><h2>{f.seller || t("卖方公司", "SELLER COMPANY")}</h2>{f.website&&<p data-field="website">{t('官网','WEBSITE')}: {f.website}</p>}</div>
          {d.logo ? (
            <img src={d.logo} alt={t('企业 Logo', 'Company logo')} />
          ) : (
            <span className="logo-placeholder" data-html2canvas-ignore="true">
              {d.language === 'en' ? 'COMPANY LOGO' : '企业 LOGO'}
              <br />
              {d.language === 'en' ? 'Upload in editor' : '点击左侧上传'}
            </span>
          )}
        </div>
        <div className="preview-doc-heading">
          <div>
            {d.language!=='zh'&&<small>{types[d.kind][1]}</small>}
            <h2>{d.language === "en" ? types[d.kind][1] : types[d.kind][0]}</h2>
          </div>
          <span><span data-field="number">NO. {f.number}</span><br/><span data-field="date">{t('日期','DATE')}: {f.date || '--'}</span></span>
        </div>
        <div className="preview-parties">
          {party(true)}
          {party(false)}
        </div>
        <table className="reference-product-table">
          <colgroup>{[5,50,13,15,17].map(w=><col key={w} style={{width:w+'%'}}/>)}</colgroup>
          <thead>
            <tr>
              <th>#</th>
              <th>{t("产品信息", "PRODUCT")}</th>
              <th>{stackedHeading("数量 / 单位", "QTY / UNIT")}</th>
              <th>{stackedHeading("单价", "UNIT PRICE")}</th>
              <th>{t("金额", "AMOUNT")}</th>
            </tr>
          </thead>
          <tbody>
            {d.rows.map((r, i) => (
              <tr key={r.id}>
                <td>{i + 1}</td>
                <td>
                  <div className="preview-product">
                    {r.image && <img src={r.image} alt={productName(r,d.language)} />}
                    <div>
                      <strong>{productName(r,d.language) || displayedName(d,r)}</strong>
                      {r.code && <p data-row-field="code">{t('商品编码','PRODUCT CODE')}: {r.code}</p>}
                      {r.spec && <p data-row-field="spec">{t('规格','SPECIFICATION')}: {r.spec}</p>}
                      {d.kind==='CD'&&<dl className="preview-row-customs">{customsRowFields.map(([k,cn,en])=><div key={k} data-row-field={k}><dt>{t(cn,en)}</dt><dd>{r[k as keyof Row] || '--'}</dd></div>)}</dl>}
                    </div>
                  </div>
                </td>
                <td>
                  {[r.name,r.nameEn,r.code,r.spec,r.qty,r.price,r.image].some(Boolean)?`${r.qty||'--'} ${presetText(r.unit||'',d.language)}`:'--'}
                </td>
                <td>{money(r.price,true)}</td>
                <td>{amount(r) || '--'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="reference-total">
          {d.kind === "PI" && (
            <>
              <p>
                {t("产品金额", "SUBTOTAL")} <strong>{f.currency} {totals(d).subtotal}</strong>
              </p>
              <p>
                {t("运费", "FREIGHT")} <strong data-field="freight">{f.currency} {money(f.freight?.trim() || "0")}</strong>
              </p>
            </>
          )}
          <p>
            {t("合计", "TOTAL")}{" "}
            <strong>
              {f.currency || "USD"}{" "}
              {
                totals({
                  ...d,
                  fields: {
                    ...f,
                    freight: d.kind === "PI" ? f.freight : "0",
                    discount: "0",
                  },
                }).total
              }
            </strong>
          </p>
        </div>
        {d.kind === "CD" && (
          <div className="preview-customs">
            {customsFields.map(([k, cn, en]) => (
              <div key={k} data-field={k}>
                <small>{t(cn, en)}</small>
                <p>
                  {f[k] || '--'}
                </p>
              </div>
            ))}
          </div>
        )}
        <div className={'preview-terms'+(d.kind==='CD'?' vertical':'')}>
          {[
            ["incoterm", "贸易条款", "TRADE TERMS"],
            ["payment", "付款方式", "PAYMENT"],
            ["delivery", "交期", "DELIVERY"],
          ].map(([k, cn, en]) => (
            <p key={k} data-field={k}>
              <strong>{t(cn, en)}</strong><span>{presetText(f[k] || '', d.language) || "--"}</span>
            </p>
          ))}
        </div>
        {d.notes&&<section className="preview-remarks" data-field="notes"><strong>{t('备注','REMARKS')}</strong><p>{d.notes}</p></section>}
        <div className="preview-bank">{f.bankName?<span data-field="bankName">{t('银行','BANK')}: {f.bankName}</span>:<span>{t('银行信息','BANK INFORMATION')}</span>}{f.bankAccount&&<span data-field="bankAccount">{t('账号','A/C')}: {f.bankAccount}</span>}{f.swift&&<span data-field="swift">SWIFT: {f.swift}</span>}</div>
      </article>
    </section>
  );
}
