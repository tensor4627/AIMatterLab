import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {frontendComponentLoader} from '../helpers/frontend-component-loader.mjs';

const load = frontendComponentLoader();
const {Button} = load('frontend/ui/Button.tsx');
const {Field} = load('frontend/ui/Field.tsx');
const {StatusBadge,statusLabel} = load('frontend/ui/StatusBadge.tsx');
const {EmptyState,ErrorState,LoadingState} = load('frontend/ui/States.tsx');
const {default: Notice} = load('frontend/ui/Notice.tsx');
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));

test('status badges retain semantic values and provide a distinct icon plus localized text', () => {
 const rows = [
  ['draft','pencil-line','草稿','Draft'], ['queued','clock','排队中','Queued'],
  ['validating','shield-ellipsis','验证中','Validating'], ['ready','circle-dot','就绪','Ready'],
  ['running','loader-circle','运行中','Running'], ['succeeded','circle-check','已完成','Succeeded'],
  ['failed','circle-x','失败','Failed'], ['blocked','ban','环境阻塞','Blocked'],
  ['passed','circle-check','通过','Passed'], ['cancelled','circle-minus','已取消','Cancelled'],
  ['unknown','circle-help','状态未知','Unknown'], ['not_run','circle-dashed','未验证','Not Validated'],
 ];
 for (const [status, icon, chinese, english] of rows) {
  const html = render(StatusBadge, {status,'data-testid':'workflow-status'});
  assert.match(html, new RegExp('data-status="'+status+'"'));
  assert.match(html, /data-testid="workflow-status"/);
  assert.match(html, new RegExp('lucide-'+icon+'\\b'));
  assert.match(html, /<svg[^>]+aria-hidden="true"/);
  assert.match(html, new RegExp(chinese));
  assert.equal(statusLabel(status,'en'), english);
 }
 assert.equal(statusLabel('checking_files','en'), 'checking_files');
 assert.match(render(StatusBadge,{status:'checking_files'}), /data-tone="warning".*checking_files/s);
});

test('disabled reason keeps the button focusable and suppresses activation', () => {
 let calls = 0, prevented = 0, stopped = 0;
 const active = {onClick:() => calls++,children:'Run','data-testid':'run'};
 const unavailable = Button({...active,disabled:true,disabledReason:'Select an environment'});
 const control = unavailable.props.children;
 assert.equal(unavailable.props.content,'Select an environment');
 assert.equal(control.type,'button');
 assert.equal(control.props['aria-disabled'],true);
 assert.equal(control.props.disabled,false);
 assert.equal(control.props.tabIndex,undefined);
 assert.equal(control.props['data-testid'],'run');
 control.props.onClick({preventDefault(){prevented++;},stopPropagation(){stopped++;}});
 assert.deepEqual([calls,prevented,stopped],[0,1,1]);
 Button(active).props.onClick();
 assert.equal(calls,1);

 const idle = render(Button,{loading:false,children:'Review'});
 const loading = render(Button,{loading:true,children:'Review'});
 assert.match(idle,/data-loading-slot="true"/);
 assert.match(loading,/data-loading-slot="true"/);
 assert.match(loading,/aria-busy="true"/);
 assert.match(loading,/aml-button-spinner/);
 assert.match(loading,/>Review<\/button>/);
 assert.match(render(Button,{variant:'icon','aria-label':'Remove file',children:'×'}),/aria-label="Remove file"/);
});

test('field links label, explanation, source and error to its input', () => {
 const html = render(Field,{
  label:'Time step', required:true, unit:'fs', controlId:'timestep',
  description:'Check the engine limits.', defaultSource:'Engine contract', error:'Enter a positive value.',
  children: attributes => React.createElement('input',attributes),
 });
 assert.match(html,/<label[^>]*for="timestep"[^>]*>Time step/);
 assert.match(html,/<input[^>]*id="timestep"[^>]*aria-required="true"[^>]*aria-invalid="true"/);
 const descriptions = html.match(/aria-describedby="([^"]+)"/)[1].split(' ');
 assert.equal(descriptions.length,3);
 for (const id of descriptions) assert.ok(html.includes('id="'+id+'"'));
 assert.match(html,/aml-field-unit">fs<\/span>/);
});

test('notice and fallback states keep distinct announcement and recovery behavior', () => {
 assert.match(render(Notice,{severity:'warning',children:'Check target'}),/data-severity="warning"[^>]*role="status"/);
 assert.match(render(Notice,{severity:'error',children:'Read failed'}),/data-severity="error"[^>]*role="alert"/);
 const action=React.createElement('button',null,'Try again');
 assert.match(render(EmptyState,{title:'No runs',body:'Start a workflow',action}),/No runs.*Start a workflow.*Try again/s);
 const failure=render(ErrorState,{title:'Read failed',retained:'Inputs retained',details:'Exact receipt',action});
 assert.match(failure,/role="alert".*Read failed.*Inputs retained.*Try again.*<details[^>]*>.*Exact receipt/s);
 assert.doesNotMatch(failure,/<details[^>]* open/);
 assert.match(render(LoadingState,{label:'Reading',phase:'Checking targets'}),/aria-busy="true".*Reading · Checking targets/s);
 assert.equal(render(LoadingState,{busy:false,label:'Reading'}),'');
});
