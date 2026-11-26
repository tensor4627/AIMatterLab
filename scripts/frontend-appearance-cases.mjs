import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';

function luminance(color) {
  assert.match(color,/^rgb\(/);
  const channels = color.match(/[\d.]+/g).map(channel => Number(channel) / 255);
  const linear = channels.map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function ratio(foreground,background) {
  const [dark,light] = [luminance(foreground),luminance(background)].sort((a,b) => a-b);
  return (light + 0.05) / (dark + 0.05);
}

export async function frontendAppearanceCases({check,out}) {
  if (process.env.STUDIO_FRONTEND_APPEARANCE_MATRIX !== '1') return;
  const baseline = process.env.STUDIO_FRONTEND_APPEARANCE_BASELINE === '1';
  const defaultMode = [undefined,'no-preference'];
  const modes = baseline ? [defaultMode] : [defaultMode,...[11,17].flatMap(minimum =>
    ['no-preference','reduce'].map(motion => [minimum,motion]))];
  for (const theme of ['dark','light']) {
    for (const width of [1024,1366]) {
      for (const [minimum,motion] of modes) {
        const name = `design-appearance-${theme}-${width}-${minimum ?? 'default'}-${motion}`;
        await check(name,async page => {
          await page.setViewportSize({width,height:768});
          await page.emulateMedia({reducedMotion:motion});
          await page.evaluate(({theme,minimum}) => {
            Object.assign(window.__test.settings,{theme,...minimum && {minimumFontSize:minimum}});
            return window.renderTest('App');
          },{theme,minimum});
          const html = page.locator(`html[data-theme="${theme}"]`);
          await html.waitFor({state:'attached',timeout:15000});
          await page.locator('.titlebar .brand strong').waitFor({timeout:15000});
          const captured = new Map();
          const capture = async label => {
            const mustDiffer = ['settings','updates','accounts','jobs','tools','palette','assets','compute'].includes(label);
            for (let attempt=0;attempt<3;attempt++) {
              await page.evaluate(async () => {
                await document.fonts.ready;
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
              });
              const screenshot = await page.screenshot({animations:'disabled'});
              if (mustDiffer && [...captured.values()].some(previous => previous.equals(screenshot))) continue;
              captured.set(label,screenshot);
              await writeFile(path.join(out,`${name}-${label}.png`),screenshot);
              return;
            }
            assert.fail(`Electron returned a previous frame when capturing ${label}`);
          };
          const workspace = page.locator('.workspace-shell');
          if (await workspace.getByTestId('show-workspace').isVisible()) {
            await workspace.getByTestId('show-workspace').click();
          }
          const primary = page.getByTestId('new-computation').filter({visible:true}).first();
          await primary.waitFor();
          await page.mouse.move(1,1);
          const paint = () => primary.evaluate(async button => {
            await Promise.allSettled(button.getAnimations().filter(animation=>animation instanceof CSSTransition).map(animation=>animation.finished));
            const style = getComputedStyle(button);
            return [style.color,style.backgroundColor,style.fontSize];
          });
          const resting = await paint();
          await capture('workspace');
          await primary.hover();
          await page.waitForFunction(node => node.matches(':hover'),await primary.elementHandle());
          await capture('primary-hover');
          const hover = await paint();
          await page.mouse.down();
          const pressed = await paint();
          await capture('primary-pressed');
          await page.mouse.move(1,1);
          await page.mouse.up();
          const paints = {resting,hover,pressed};
          if (!baseline) {
            for (const [state,[foreground,background]] of Object.entries(paints)) {
              assert(ratio(foreground,background)>=4.5,`${theme} primary ${state} has ≥4.5:1 text contrast`);
            }
            assert.notEqual(resting[1],hover[1],'hover is visible');
            assert.notEqual(hover[1],pressed[1],'active press is visible');
          }
          await writeFile(path.join(out,`${name}-button.json`),JSON.stringify(paints,null,2));

          const showChat = workspace.getByTestId('show-agent');
          if (await showChat.isVisible()) await showChat.click();
          await workspace.locator('.composer textarea').waitFor();
          await capture('conversation');
          await page.getByRole('button',{name:'设置',exact:true}).filter({visible:true}).click();
          const dialog = page.getByRole('dialog');
          const font = dialog.getByTestId('minimum-font');
          await font.waitFor();
          if (!baseline) assert.equal(await font.inputValue(),String(minimum ?? 13));
          await capture('settings');
          await dialog.getByRole('button',{name:'软件更新',exact:true}).click();
          await capture('updates');
          await page.keyboard.press('Escape');
          await dialog.waitFor({state:'hidden'});
          await page.getByTestId('open-accounts').filter({visible:true}).click();
          await dialog.getByRole('heading',{name:'账号与 API'}).waitFor();
          await capture('accounts');
          await page.keyboard.press('Escape');
          await dialog.waitFor({state:'hidden'});

          for (const [id,label] of [['runs','jobs'],['tools','tools']]) {
            await page.locator('nav').getByTestId('navigate-'+id).filter({visible:true}).click();
            await workspace.locator('.main-column').waitFor();
            await capture(label);
          }
          await page.keyboard.press('Control+k');
          await dialog.getByRole('heading',{name:'搜索与命令'}).waitFor();
          await capture('palette');
          await dialog.getByRole('button',{name:'数据资产',exact:true}).click();
          await dialog.waitFor({state:'hidden'});
          await capture('assets');
          await page.keyboard.press('Control+k');
          await dialog.getByRole('button',{name:'连接计算资源…',exact:true}).click();
          await page.getByTestId('compute-choice-local').waitFor();
          await capture('compute');
        });
      }
    }
  }
}
