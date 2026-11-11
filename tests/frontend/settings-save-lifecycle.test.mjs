import test from 'node:test';
import assert from 'node:assert/strict';
import {appWorkerHarness} from '../helpers/app-worker-hooks.mjs';
import {settingsPageHarness as harness} from '../helpers/settings-page-hooks.mjs';

for(const field of ['theme','workerPort'])test('old settings acknowledgement preserves newer '+field+' edit',async()=>{
 const h=harness();try{
  await h.flush();h.save();await h.flush();
  if(field==='theme')h.find(node=>node.type==='select'&&node.props.value==='dark').props.onChange({target:{value:'light'}});
  else{h.find(node=>node.type==='button'&&h.text(node).includes('计算连接')).props.onClick();await h.flush();h.find(node=>node.type==='input'&&node.props.type==='number'&&node.props.value===8767).props.onChange({target:{value:'8768'}});}
  await h.flush();const newer=h.settings[field];h.gate.resolve(h.calls[0].data);await h.flush();
  assert.equal(h.settings[field],newer);assert.equal(h.saved.length,1,'acknowledges the persisted baseline for Cancel');
  assert(h.text(h.find(node=>node.props?.className==='settings-footer')).includes('未保存修改'));assert.deepEqual(h.errors,[]);
 }finally{h.unmount();}
});

test('current settings acknowledgement applies normalized result and duplicate clicks dispatch once',async()=>{
 const h=harness();try{await h.flush();h.save();h.save();assert.equal(h.calls.length,1);const result={...h.calls[0].data,fontSize:14};h.gate.resolve(result);await h.flush();assert.equal(h.settings.fontSize,14);assert.deepEqual(h.saved,[result]);assert(h.text(h.find(node=>node.props?.className==='settings-footer')).includes('设置已保存'));}finally{h.unmount();}
});

for(const outcome of ['resolve','reject'])test('settings '+outcome+' after unmount cannot alter another editor or report stale feedback',async()=>{
 const h=harness();await h.flush();h.save();h.unmount();if(outcome==='resolve')h.gate.resolve(h.calls[0].data);else h.gate.reject(Error('old editor failure'));await h.flush();assert.deepEqual(h.saved,[]);assert.deepEqual(h.errors,[]);
});

test('settings replaced externally during save retain the newer owner values',async()=>{
 const h=harness();try{await h.flush();h.save();h.external({distribution:'Newly selected Ubuntu'});h.gate.resolve(h.calls[0].data);await h.flush();assert.equal(h.settings.distribution,'Newly selected Ubuntu');}finally{h.unmount();}
});

test('App keeps the same settings editor open until its pending save settles',async()=>{
 const h=appWorkerHarness();try{
  await h.flush();const props=h.openSettings();props.onChange({...props.settings,theme:'light'});props.onSavingChange(true);await h.flush();
  h.find(node=>node.type==='./SettingsPage').props.onClose();await h.flush();
  const saving=h.find(node=>node.type==='./SettingsPage');assert.equal(saving.props.settings.theme,'light');
  assert.equal(h.find(node=>node.type==='Modal'&&node.props.title==='工作台设置').props.closeDisabled,true);
  saving.props.onOpenComputeResources();await h.flush();h.find(node=>node.type==='./SettingsPage');
  assert.throws(()=>h.find(node=>node.type==='./ComputeConnectionChooser'));
  saving.props.onSaved(saving.props.settings);saving.props.onSavingChange(false);await h.flush();
  h.find(node=>node.type==='./SettingsPage').props.onClose();await h.flush();
  assert.equal(h.openSettings().settings.theme,'light');
 }finally{h.unmount();}
});
