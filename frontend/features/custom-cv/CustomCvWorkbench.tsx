import {t} from '../../ui/i18n';
import Disclosure from '../../ui/Disclosure';
import Notice from '../../ui/Notice';
import {useEffect,useRef,useState} from 'react';
import {clearSessionDraft,readSessionDraft,useSessionDraft,writeSessionDraft} from '../../ui/session-drafts';
import {customCvChoiceKey,customCvDraftKey,customDraftDifferences,customDraftMatches,type CustomCvDraft} from './custom-cv-drafts';
import StructuredValue from "../pygas/PygasStructuredValue";
import type {ParameterEditor} from "../pygas/pygas-composer-types";
import type {Expected,FormulaSpec,ParamValue,WorkbenchProps} from './custom-cv-types';
import {approvals,missingSpec,missingValues,numericalCurrent,same} from './custom-cv-state';
import './custom-cv.css';
import {HelpTip} from '../../ui/Tooltip';
import CustomCvLibrary from './CustomCvLibrary';
import CustomCvNumericScope,{numericScopeCurrent} from './CustomCvNumericScope';
export default function CustomCvWorkbench(p:WorkbenchProps){
 const locale = {language:p.language??'zh-CN'} as const;
 const draftKey=customCvDraftKey(p.taskId,p.entry.id),stored=useSessionDraft<CustomCvDraft>(draftKey),draft=stored?.value;
 const spec=draft?.spec||p.entry.spec,values=draft?.values||p.entry.parameterValues,base=draft?.base||p.entry.expected,dirty=!!draft,conflict=dirty&&!same(base,p.entry.expected);
 const [editing,setEditing]=useState(false),[reference,setReference]=useState(''),[localError,setLocalError]=useState(''),[pending,setPending]=useState(false),[readResult,setReadResult]=useState<'matched'|'different'|''>('');
 const owner=useRef(draftKey),alive=useRef(true),pendingRef=useRef(false);owner.current=draftKey;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{setEditing(false);setReference('');setLocalError('');setPending(false);setReadResult('');pendingRef.current=false;},[draftKey]);
 useEffect(()=>{p.onDraftChange?.(dirty||conflict);},[dirty,conflict,draftKey,p.onDraftChange]);
 useEffect(()=>{if(draft&&!same(base,p.entry.expected)&&customDraftMatches(draft,p.entry)){clearSessionDraft(draftKey,stored?.version);setReadResult('matched');}},[draftKey,stored,JSON.stringify(p.entry.expected)]);
 const approved=approvals(p.entry),numerical=approved.formula&&approved.code&&numericalCurrent(p.entry,p.runtime,p.currentStructure),specMissing=missingSpec(spec),valueMissing=missingValues(spec,values),busy=!!p.busy||pending,shared=p.entry.sharing[p.provider]===true,stage=!approved.formula?0:!approved.code?1:!numerical?2:3;
 const stepNames=[t("数学定义", locale),t("生成代码审阅", locale),t("短数值检查", locale),t("复用到 pyGAS 图", locale)];
 function update(patch:Partial<CustomCvDraft>){const current=readSessionDraft<CustomCvDraft>(draftKey)?.value;writeSessionDraft(customCvChoiceKey(p.taskId),p.entry.id);writeSessionDraft(draftKey,{spec:p.entry.spec,values:p.entry.parameterValues,base:p.entry.expected,...current,...patch});setLocalError('');setReadResult('');}
 function changeSpec<K extends keyof FormulaSpec>(key:K,value:FormulaSpec[K]){
update({spec:{...spec,[key]:value}});}
 function changeValue(name:string,value:ParamValue){update({values:{...values,[name]:value}});}
 async function operation(fn:()=>unknown|Promise<unknown>,clean=false){if(busy||pendingRef.current)return;pendingRef.current=true;setPending(true);setLocalError('');const key=draftKey,version=stored?.version;
  try{await fn();if(clean)clearSessionDraft(key,version);}catch(error){if(alive.current&&owner.current===key)setLocalError(error instanceof Error?error.message:String(error));}finally{if(alive.current&&owner.current===key){pendingRef.current=false;setPending(false);}}
 }
 async function readSaved(){
  const key=draftKey,version=stored?.version;setReadResult('');
  await operation(async()=>{
   const entry=await p.onReload({preserveDraft:true});if(!entry)return;
   if(entry.id!==p.entry.id||entry.taskId!==p.taskId)throw Error(t("实际保存记录与当前定义不匹配，本地草稿仍保留。", locale));
   const latest=readSessionDraft<CustomCvDraft>(key);if(latest&&latest.version!==version)return;
   const matching=customDraftMatches(latest?.value||{spec,values,base},entry);
   if(matching)clearSessionDraft(key,version);
   if(alive.current&&owner.current===key)setReadResult(matching?'matched':'different');
  });
 }
 function continueLocal(){if(busy||!draft)return;update({base:p.entry.expected});}
 const differences=draft?customDraftDifferences(draft,p.entry):[];
 const displayValue=(value:unknown)=>value===undefined?t("未设置", locale):typeof value==='string'?value:JSON.stringify(value,null,2);
 const blocked=busy||conflict,checksActive=['queued','running'].includes(p.entry.numerical?.status||''),checksUnknown=p.entry.numerical?.status==='unknown';
 function parameter(parameter:FormulaSpec['parameters'][number]){
  const editor:ParameterEditor={
   type:parameter.type==='integer'?'integer':parameter.type==='number'?'number':'array',
   itemType:parameter.type==='integer_vector'?'integer':'number',
   shape:parameter.type==='number_matrix'?[null,null]:parameter.type.endsWith('_vector')?[null]:undefined,
   source_sha256:base.specSha||'',basis:'Private formula parameter schema',
  };
  const disabled=blocked||!p.capabilities.parameterTypes.includes(parameter.type);
  return <div className={'ccv-parameter '+(valueMissing.includes(parameter.name)?'missing':'')} key={parameter.name} data-parameter={parameter.name}>
   <div className="ccv-parameter-heading">
    <strong>{parameter.name}{parameter.required?' *':''}</strong><span>{parameter.units}</span>
    <small>{parameter.type}{parameter.min!==undefined?' · min '+parameter.min:''}{parameter.max!==undefined?' · max '+parameter.max:''}</small>
    {parameter.description&&<HelpTip label={parameter.name+' · '+t("参数说明", locale)} content={parameter.description}/>}
   </div>
   <StructuredValue value={values[parameter.name]} editor={editor} label={'custom.parameter.'+parameter.name} disabled={disabled} language={p.language} onChange={value=>changeValue(parameter.name,value as ParamValue)}/>
   {Object.hasOwn(parameter,'default')&&<Disclosure summary={<>{t("本公式声明的默认值", locale)}</>}><code>{JSON.stringify(parameter.default)}</code><button type="button" disabled={blocked} onClick={()=>{const next={...values};delete next[parameter.name];update({values:next});}}>{t("清除覆盖值，保存时使用声明默认", locale)}</button></Disclosure>}
  </div>;
 }
 function primary(){if(dirty)return {text:t("保存定义与参数", locale),disabled:blocked||!!specMissing.length,run:()=>operation(()=>p.onSave(spec,values,base),true)};if(!approved.formula)return {text:t("确认数学定义并生成实现", locale),disabled:blocked||!!specMissing.length||!p.capabilities.approveFormula,run:()=>operation(()=>p.onApproveFormula(p.entry.expected))};if(!approved.code)return {text:t("确认已审阅这份代码", locale),disabled:blocked||!p.entry.code||!p.capabilities.approveCode,run:()=>operation(()=>p.onApproveCode(p.entry.expected))};if(checksUnknown)return {text:t("核对原数值检查", locale),disabled:busy,run:()=>operation(p.onReload)};if(!numerical)return {text:checksActive?t("数值检查进行中", locale):t("运行短数值检查", locale),disabled:blocked||checksActive||!!valueMissing.length||p.runtime?.status!=='passed'||!p.currentStructure||!numericScopeCurrent(p.numericScope,p.entry,p.taskId,p.runtime,p.currentStructure)||!p.capabilities.validate,run:()=>operation(()=>p.onValidate(p.entry.expected,reference||undefined))};return {text:t("用于当前 pyGAS 组合图", locale),disabled:blocked||!p.capabilities.attach,run:()=>operation(()=>p.onAttach(p.entry.expected))};}
 const action=primary();
 return <section className="custom-cv-workbench" data-testid="custom-cv-workbench" aria-busy={busy}><header><div><h2>{p.entry.name||t("自定义 CV", locale)}</h2><p className="ccv-identity">{t("私有 CV", locale)} · pyGAS primitive</p></div><CustomCvLibrary entries={p.entries} currentId={p.entry.id} busy={busy} dirty={dirty||conflict} reuseSupported={p.capabilities.reuse===true} language={p.language} onSelect={p.onSelect} onReuse={p.onReuse?(id,expected)=>operation(()=>p.onReuse!(id,expected)):undefined}/></header>
 <ol className="ccv-steps" aria-label={t("自定义 CV 阶段", locale)}>{stepNames.map((name,index)=><li key={name} aria-current={index===stage?'step':undefined} className={index===stage?'current':''}><span>{index+1}</span>{name}</li>)}</ol>
 {conflict&&<Notice compact severity="error" className="ccv-notice" >{t("该定义已有更新。本地修改仍保留；核对两侧内容后，选择继续编辑本地草稿或使用保存版本。", locale)}</Notice>}
 {readResult==='matched'&&<Notice compact className="ccv-read-result"  data-testid="custom-read-matched">{t("已核对：实际保存记录与本地输入一致。未再次保存、共享或运行。", locale)}</Notice>}
 {(dirty||readResult==='different')&&<section className="ccv-reconcile" data-testid="custom-draft-reconcile"><div className="ccv-reconcile-heading"><div><strong>{t("核对保存记录，保留本地草稿", locale)}</strong><HelpTip label={t("核对保存范围", locale)} content={t("保存提示中断或不确定时，先读取实际记录。此操作不保存、不共享，也不启动检查。", locale)}/></div><button type="button" data-testid="custom-read-saved" disabled={busy} onClick={()=>void readSaved()}>{t("保留草稿，核对保存记录", locale)}</button></div>
 {readResult==='different'&&<Notice compact  data-testid="custom-read-different">{t("实际保存记录与本地输入不同。本地修改仍保留，请核对差异。", locale)}</Notice>}
 {!!differences.length&&(conflict||readResult==='different')&&<Disclosure className="ccv-differences" open summary={<>{t("当前保存版本与本地输入", locale)} · {differences.length}</>}>{differences.map(item=><section className="ccv-difference" key={item.group+'.'+item.key}><h4>{item.group==='parameter'?t("参数", locale):t("定义", locale)} · {item.key}</h4><div className="ccv-difference-values"><div><strong>{t("当前保存版本", locale)}</strong><pre tabIndex={0}>{displayValue(item.saved)}</pre></div><div><strong>{t("本地输入（未保存）", locale)}</strong><pre tabIndex={0}>{displayValue(item.local)}</pre></div></div></section>)}</Disclosure>}
 {conflict&&<div className="ccv-reconcile-actions"><button type="button" data-testid="custom-continue-local" disabled={busy} onClick={continueLocal}>{t("已核对差异，继续编辑本地草稿", locale)}</button><button type="button" data-testid="custom-use-saved" disabled={busy} onClick={()=>{clearSessionDraft(draftKey,stored?.version);setReadResult('');setLocalError('');}}>{t("使用保存版本，放弃本地修改", locale)}</button></div>}
 </section>}
 {(p.error||localError)&&<Notice compact severity="error" className="ccv-notice" >{p.error||localError}</Notice>}
 <section className="ccv-library-review"><strong>{t("已记录的实际类库评估", locale)}</strong>{p.libraryReview?<><p>{t("已对照的类", locale)} · {p.libraryReview.classes.join(' · ')}</p><Disclosure summary={<>{t("评估说明与来源版本", locale)}</>}><p>{p.libraryReview.reason}</p>{Object.entries(p.libraryReview.source_files).map(([name,sha])=><small key={name}>{name} · SHA256 {sha}</small>)}</Disclosure></>:<p>{t("此条目未返回类库评估收据。", locale)}</p>}</section>
 <div className="ccv-definition"><strong>{t("数学定义", locale)}</strong><p className="ccv-formula" data-testid="custom-formula">{spec.formula||t("等待 Agent 准备明确公式", locale)}</p><dl><dt>{t("输出单位", locale)}</dt><dd>{spec.units||'—'}</dd><dt>PBC</dt><dd>{spec.pbc||'—'}{spec.pbc==='row_mic'&&<small>{t("按行晶胞分数坐标逐分量 wrap；不保证任意倾斜晶胞的欧氏最近像。", locale)}</small>}</dd><dt>{t("有序原子选择", locale)}</dt><dd>{spec.atom_selection.join(', ')||'—'}</dd><dt>{t("输出维度", locale)}</dt><dd>{spec.output_size??'—'}</dd></dl>
 <button type="button" disabled={busy} onClick={()=>setEditing(old=>!old)} aria-expanded={editing}>{t("调整数学定义", locale)}</button><button type="button" disabled={busy} onClick={()=>p.onDiscuss({reason:'formula',includePrivate:shared,...shared?{entryId:p.entry.id}:{}})}>{t("与 Agent 讨论定义", locale)}</button>
 {editing&&<div className="ccv-definition-edit"><label>{t("名称", locale)}<input aria-label="custom.name" value={spec.name} disabled={blocked} onChange={event=>changeSpec('name',event.target.value)}/></label><label>{t("数学公式（说明文字，不执行）", locale)}<textarea aria-label="custom.formula" value={spec.formula} disabled={blocked} onChange={event=>changeSpec('formula',event.target.value)}/></label><label>{t("输出单位", locale)}<input aria-label="custom.units" value={spec.units} disabled={blocked} onChange={event=>changeSpec('units',event.target.value)}/></label><label>{t("有效定义域", locale)}<textarea aria-label="custom.domain" value={spec.domain} disabled={blocked} onChange={event=>changeSpec('domain',event.target.value)}/></label><label>PBC<select aria-label="custom.pbc" value={spec.pbc} disabled={blocked} onChange={event=>changeSpec('pbc',event.target.value as FormulaSpec['pbc'])}><option value="">—</option><option value="none">none</option><option value="row_mic">row_mic</option></select></label><label>{t("输出维度", locale)}<input aria-label="custom.output_size" type="number" min={1} max={16} value={spec.output_size??''} disabled={blocked} onChange={event=>changeSpec('output_size',event.target.value?Number(event.target.value):null)}/></label><Disclosure summary={<>{t("受限公式表达式（不是任意 Python）", locale)}</>}><textarea aria-label="custom.expression" value={spec.expression} disabled={blocked} onChange={event=>changeSpec('expression',event.target.value)}/><small>{p.capabilities.expressionFunctions.join(' · ')}</small><p>{t("只有已实现的解析器允许项可生成实现；前端不会求值。", locale)}</p></Disclosure></div>}</div>
 <section className="ccv-parameters"><h3>{t("本次公式参数", locale)}</h3>{spec.parameters.length?spec.parameters.map(parameter):<p>{t("本定义没有构造参数。", locale)}</p>}{!!valueMissing.length&&<Notice compact >{t("待补参数", locale)} · {valueMissing.join(', ')}</Notice>}</section>
 <Disclosure className="ccv-domain" open={stage===0||editing||dirty} summary={<>{t("定义域、符号与参考来源", locale)}</>}><p className="ccv-domain-full">{spec.domain||'—'}</p><small>{t("参数表核对声明的类型与闭区间 min/max；开放定义域、奇点条件仍需按完整数学定义核验。", locale)}</small>{spec.symbols.map(symbol=><p key={symbol.name}><strong>{symbol.name}</strong> · {symbol.meaning} · {symbol.units} · {symbol.domain}</p>)}{spec.singularities.map((text,index)=><p key={index}>{text}</p>)}{spec.references?.map(url=><p key={url}>{url}</p>)}</Disclosure>
 {approved.formula&&p.entry.code&&<Disclosure className="ccv-code" open={stage===1} summary={<>{t("生成实现与独立审阅", locale)} · {p.entry.expected.codeSha?.slice(0,12)}</>}><small data-testid="custom-code-sha">SHA256 {p.entry.expected.codeSha}</small><pre tabIndex={0}>{p.entry.code}</pre><small>{t("确认此代码只表示审阅当前快照，不代表已加载、数值正确或可用于 MD。", locale)}</small></Disclosure>}
 {approved.code&&<section className="ccv-numerical">
  <h3>{t("已有计算环境中的短数值检查", locale)}</h3>
  <dl className="ccv-check-summary">
   <div><dt>{t("计算环境", locale)}</dt><dd>{p.runtime?.name||t("当前流程尚未关联可检查的环境", locale)} · {p.runtime?.status||'not_run'}{p.runtime?' · '+p.runtime.maxSeconds+' s':''}</dd></div>
   <div><dt>{t("当前流程结构（只读）", locale)}</dt><dd>{p.currentStructure?.name||'not_run'}{!p.numericScope&&p.currentStructure&&<small>SHA256 {p.currentStructure.sha256}</small>}</dd></div>
  </dl>
  {p.runtime?.reason&&<p>{p.runtime.reason}</p>}
  <div className="ccv-reference-heading"><label htmlFor="custom-reference">{t("独立参考数据（可选）", locale)}</label><HelpTip label={t("独立参考范围", locale)} content={t("优先使用已有结构和环境。没有独立参考时可做自洽检查，但不能复用到图；后端仅对明确支持的定义提供来源绑定解析参考。", locale)}/></div>
  <select id="custom-reference" aria-label="custom.reference" value={reference} disabled={busy||checksActive} onChange={event=>setReference(event.target.value)}><option value="">{t("未提供独立参考文件", locale)}</option>{p.referenceAssets.map(asset=><option key={asset.id} value={asset.id}>{asset.name}</option>)}</select>
  {p.onImportReference&&<button type="button" aria-label="custom.reference.import" disabled={busy||checksActive||dirty} onClick={()=>void operation(async()=>{const id=await p.onImportReference!();if(id)setReference(id);})}>{t("导入独立参考文件", locale)}</button>}
  {p.referenceAssets.filter(asset=>asset.id===reference).map(asset=><small key={asset.id}>SHA256 {asset.sha256}</small>)}
  <CustomCvNumericScope scope={p.numericScope} current={numericScopeCurrent(p.numericScope,p.entry,p.taskId,p.runtime,p.currentStructure)} referenceChanged={!!reference&&reference!==p.numericScope?.referenceAssetId} language={p.language}/>
  {p.entry.numerical&&<div className="ccv-numerical-report" data-testid="custom-numerical-report">
   <strong>{numerical&&!dirty?t("当前参数的数值检查通过", locale):t("数值检查记录（须核对当前版本）", locale)} · {p.entry.numerical.status}</strong>
   <dl className="ccv-check-summary">
    <div><dt>{t("实现自洽检查", locale)}</dt><dd data-check-status={p.entry.numerical.selfConsistency?.status}>{p.entry.numerical.selfConsistency?.status||'not_run'}</dd></div>
    <div><dt>{t("独立参考比较", locale)}</dt><dd data-check-status={p.entry.numerical.independentReference?.status}>{p.entry.numerical.independentReference?.status||'not_run'}</dd></div>
    <div><dt>{t("目标 Bias / MD 验证（独立阶段）", locale)}</dt><dd data-check-status={p.entry.numerical.targetBiasAndMD?.status}>{p.entry.numerical.targetBiasAndMD?.status||'not_run'}</dd></div>
   </dl>
   {p.entry.numerical.reason&&<p>{p.entry.numerical.reason}</p>}
   {p.entry.numerical.independentReference?.reason&&<p>{p.entry.numerical.independentReference.reason}</p>}
   {p.entry.numerical.referenceKind&&<small>{p.entry.numerical.referenceKind} · {p.entry.numerical.referenceSource||'not_run'}</small>}
   {!!p.entry.numerical.checks.length&&<ul className="ccv-check-list">{p.entry.numerical.checks.map(check=><li key={check.name}><strong>{check.name}</strong><span data-check-status={check.status}>{check.status}</span><small>{check.detail}{check.maxError!==undefined&&check.maxError!==null&&<> · {t("最大误差", locale)} <code>{check.maxError}</code></>}</small></li>)}</ul>}
  </div>}
  <p className="ccv-scope-limit">{t("通过范围只限所列构型、参数、检查与环境。解析自洽或有限差分通过不等于独立参考一致、稳态相适用或消费端 Bias/MD 验证；未列出的检查仍为 not_run。", locale)}</p>
 </section>}
 <Disclosure className="ccv-technical-convention" summary={<>{t("实现与 cell 导数约定", locale)}</>}><small>Git {p.entry.gitCommit||t("版本尚未记录", locale)}</small><p>{t("候选实现按 pos_affine = (pos @ inv(cell.detach())) @ cell 计算 cell 总导数，与固定分数坐标的共变形数值检查对应。名义位置值及坐标梯度不变；需要非奇异晶胞。该实现约定须在生成源码与数值报告中核对。", locale)}</p></Disclosure>
 <Disclosure className="ccv-sharing" summary={<>{t("Agent 协作与私有内容共享", locale)}</>}><label><input type="checkbox" aria-label="custom.share" checked={shared} disabled={busy||dirty||conflict||!p.capabilities.sharing} onChange={event=>void operation(()=>p.onSharing(event.target.checked,p.provider,p.entry.expected))}/>{t("允许当前服务商读取此定义与源码", locale)} · {p.provider}</label><p>{t("默认不共享。已有公开 skill 许可不涵盖此私有库；切换服务商不会继承另一家的许可。", locale)}</p></Disclosure>
 <Disclosure summary={<>{t("已知稳态相参考比较（建议）", locale)}</>}><p>{t("首次使用后，建议在已知稳态相上比较参考 CV、分布与异常几何。短数值检查不代表物理适用性或采样收敛。", locale)}</p><p>{p.entry.stablePhase?.status||'not_run'}</p><button type="button" disabled={busy} onClick={()=>p.onDiscuss({reason:'stable_phase',includePrivate:shared,...shared?{entryId:p.entry.id}:{}})}>{t("讨论稳态相验证方案", locale)}</button></Disclosure>
 <footer><div><Disclosure summary={<>{t("保存记录标识", locale)}</>}><small>spec SHA256 {p.entry.expected.specSha||'—'} · parameters SHA256 {p.entry.expected.parametersSha||'—'}</small></Disclosure>{dirty&&<Notice compact >{t("本地修改尚未保存，切换页面或会话仍会保留。关闭应用前请保存；之前的确认与数值记录不适用于这些修改。", locale)}</Notice>}</div><button type="button" disabled={busy} onClick={()=>{clearSessionDraft(draftKey,stored?.version);void operation(p.onReload);}}>{t(dirty ? "放弃本地修改并刷新" : "刷新实际记录", locale)}</button><button type="button" data-testid="custom-primary" disabled={action.disabled} onClick={()=>void action.run()}>{busy?t("处理中…", locale):action.text}</button></footer>
 </section>;
}
