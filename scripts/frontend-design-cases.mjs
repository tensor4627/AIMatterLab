import assert from 'node:assert/strict';
import path from 'node:path';

export async function frontendDesignCases({check,out}) {
  await check('design-layout-switches-visible-panes',async page=>{
    await page.setViewportSize({width:1366,height:768});
    await page.evaluate(()=>window.renderTest('App'));
    const shell=page.locator('.workspace-shell');
    const agent=shell.locator('.workspace-panels>.agent-panel');
    const workspace=shell.locator('.workspace-panels>.main-column');
    const draft=agent.locator('.composer textarea');
    const menu=shell.locator('.workspace-layout-menu>summary');
    async function choose(mode){
      await menu.click();
      await page.getByTestId('priority-'+mode).click();
    }
    async function expectSplit(chatFirst){
      await page.waitForFunction(()=>Array.from(document.querySelectorAll('.workspace-panels>.main-column,.workspace-panels>.agent-panel')).filter(pane=>pane.getClientRects().length).length===2);
      const a=await agent.boundingBox(),w=await workspace.boundingBox();
      assert(a&&w);
      assert.equal(a.x<w.x,chatFirst);
      assert.equal(a.width>w.width,chatFirst);
    }
    await draft.fill('Unsent layout regression draft');
    await choose('chat');await expectSplit(true);
    await shell.locator('nav:visible').getByTestId('navigate-runs').click();
    await expectSplit(false);
    await choose('chat');await expectSplit(true);
    await shell.locator('.agent-panel-toggle').click();
    assert.equal(await agent.isVisible(),false);
    await choose('chat');await expectSplit(true);
    await page.setViewportSize({width:640,height:720});
    await choose('workflow');await workspace.waitFor();assert.equal(await agent.isVisible(),false);
    await choose('chat');await agent.waitFor();assert.equal(await workspace.isVisible(),false);
    assert.equal(await draft.inputValue(),'Unsent layout regression draft');
    await page.setViewportSize({width:1366,height:768});await expectSplit(true);
    await choose('workflow');await expectSplit(false);
    await shell.locator('nav:visible').getByTestId('navigate-home').click();
    await expectSplit(true);
    assert.equal(await draft.inputValue(),'Unsent layout regression draft');
    const settings=await page.evaluate(()=>window.__test.settings);
    assert.equal(settings.agentLayout,'center');assert.equal(settings.overviewAgentLayout,'right');
  });
  for (const [width,theme,language] of [[1366,'dark','zh-CN'],[1024,'light','en']]) {
    await check('design-settings-help-'+theme,async page=>{
      await page.setViewportSize({width,height:768});
      await page.emulateMedia({reducedMotion:'reduce'});
      await page.evaluate(({theme,language})=>{
        Object.assign(window.__test.settings,{theme,language,minimumFontSize:18});
        return window.renderTest('App');
      },{theme,language});
      const settings=page.getByRole('button',{name:language==='en'?'Settings':'设置',exact:true}).first();
      await settings.click();
      const dialog=page.getByRole('dialog');
      const input=dialog.getByTestId('minimum-font');
      const help=dialog.locator('.settings-field').filter({has:page.getByTestId('minimum-font')}).getByRole('button');
      const popup=page.getByRole('tooltip');
      await help.hover();
      await popup.waitFor();
      const explanation=await popup.innerText();
      assert(explanation.length>8);
      assert.equal(await help.getAttribute('aria-describedby'),await popup.getAttribute('id'));
      const rect=await popup.boundingBox();
      assert(rect && rect.x>=0 && rect.x+rect.width<=width && rect.y>=0 && rect.y+rect.height<=768);
      const aboveNotifications=await popup.evaluate(tip=>{
        const notification=document.createElement('div');
        const box=tip.getBoundingClientRect();
        Object.assign(notification.style,{position:'fixed',left:box.left+'px',top:box.top+'px',right:'auto',bottom:'auto',
          width:box.width+'px',height:box.height+'px',transform:'none'});
        document.body.append(notification);
        try{
          return ['toast notice-surface','codex-version-notice'].every(classes=>{
            notification.className=classes;
            return document.elementFromPoint(box.left+box.width/2,box.top+box.height/2)===tip;
          });
        }finally{notification.remove();}
      });
      assert.equal(aboveNotifications,true,'help remains readable when a later notification overlaps');
      await page.screenshot({path:path.join(out,'settings-help-'+theme+'.png')});
      await page.keyboard.press('Escape');
      await popup.waitFor({state:'hidden'});
      assert(await dialog.isVisible());
      assert(!(await dialog.innerText()).includes(explanation));
      await page.mouse.move(1,1);
      await input.focus();
      await page.keyboard.press('Shift+Tab');
      assert(await help.evaluate(node=>document.activeElement===node));
      await popup.waitFor();
      await page.keyboard.press('Escape');
      await page.keyboard.press('Enter');
      await popup.waitFor();
      assert.equal(await popup.innerText(),explanation);
      const durations=await dialog.evaluate(node=>[
        getComputedStyle(node).animationDuration,
        getComputedStyle(node).transitionDuration
      ]);
      assert(durations.every(values=>values.split(',').every(value=>parseFloat(value)===0)));
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await dialog.waitFor({state:'hidden'});
      await page.emulateMedia({reducedMotion:'no-preference'});
      await settings.click();
      const motion=await dialog.evaluate(node=>{
        const style=getComputedStyle(node);
        return {name:style.animationName,seconds:parseFloat(style.animationDuration)};
      });
      assert.notEqual(motion.name,'none');
      assert(motion.seconds>0 && motion.seconds<0.5);
      await page.keyboard.press('Escape');
      await dialog.waitFor({state:'hidden'});
    });
  }
}
