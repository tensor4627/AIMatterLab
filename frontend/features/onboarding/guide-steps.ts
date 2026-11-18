import type {SetupVisit} from './SetupAssistant';

export type SetupLessonLocation = {
  destination: SetupVisit | 'ssh-login' | 'ssh-settings' | 'ssh-service';
  shortCase?: string;
};
export type GuideStep = SetupLessonLocation['destination'] | 'account' | 'wsl' | 'choose-wsl' | 'choose-ssh';
type Target = readonly [id: string, zh: string, en: string];
type Step = {title: readonly [zh: string, en: string]; targets: readonly Target[]};

const steps: Record<GuideStep, Step> = {
  'model-test': {title:['测试模型连接','Test the model connection'], targets:[
    ['composer','核对输入框中的测试消息。连接所选服务商后，点击发送。','Review the test message here. Once the provider is connected, send it to check for a reply.']
  ]},
  'tour-goal': {title:['描述计算目标','Describe your goal'], targets:[
    ['composer','把铜晶胞示例改成你想观察的量，再发送给助手。','Edit the copper example here to say what you want to measure, then send it.']
  ]},
  'short-check': {title:['准备短例','Prepare a check'], targets:[
    ['composer','核对草稿里的短例名称和计算资源，再发送给助手。','Check the example and compute resource in the draft, then send it.']
  ]},
  assets: {title:['导入结构','Import a structure'], targets:[
    ['asset-kind','在这里选择「结构 / 轨迹」，再用文件路径旁的文件夹按钮选择结构文件。','Choose Structure / trajectory here, then use the folder beside the path to pick a file.']
  ]},
  environments: {title:['登记计算环境','Register an environment'], targets:[
    ['discover','点击这里，发现并登记此作业服务上已有的计算环境。','Use this button to discover and register environments on the connected job service.'],
    ['connect-worker','先点击这里连接作业服务。接通后，此页会提供「重新发现并登记」。','Connect the job service here first. Discovery becomes available on this page once connected.']
  ]},
  extensions: {title:['获取科学工具','Find a scientific tool'], targets:[
    ['tool-sources','展开这个列表，查找所需工具的源码和安装说明。','Expand this list to find the source repository and installation guide for your tool.']
  ]},
  runs: {title:['查看运行结果','Inspect run results'], targets:[
    ['run-record','打开这条运行记录，查看状态、日志和结果。','Open this run to inspect its status, logs and results.'],
    ['run-empty','运行记录会出现在这里。查看当前提示即可了解记录读取情况。','Runs appear here. The message shows whether records have been read.'],
    ['run-search','在这里按名称查找运行。连接原作业服务后即可打开记录。','Find a run by name here. Connect its original job service to open the record.']
  ]},
  'ssh-login': {title:['登录远程资源','Sign in over SSH'], targets:[
    ['ssh-edit','查看登录提示，需要修正主机或账号时，从这里编辑连接。','Read the sign-in message. Use this button if you need to correct the host or account.'],
    ['ssh-terminal','在此终端完成登录，看到远端命令提示符后再继续。','Sign in here and wait for the remote shell prompt.'],
    ['ssh-shell','在这里查看已打开的远端终端。','Review the open remote terminal here.'],
    ['ssh-continue','从这里继续当前登录，按终端提示完成认证。','Resume this sign-in here and follow the terminal instructions.']
  ]},
  'ssh-settings': {title:['配置远程连接','Configure the remote connection'], targets:[
    ['cluster-connect-worker','先连接本地作业服务，再读取已保存的集群配置。','Connect the local job service here to load saved cluster profiles.'],
    ['cluster-profile','选择要使用的集群配置，核对主机和登录信息。','Choose the cluster profile here and check its host and sign-in details.'],
    ['cluster-host','在这里填写新连接的 SSH 主机，再填写用户名。','Enter the SSH host for your new connection here, then enter the username.']
  ]},
  'ssh-service': {title:['准备远程作业服务','Prepare the remote job service'], targets:[
    ['composer','核对草稿中的连接信息，再请助手检查远端 Python 环境。','Review the connection in this draft, then ask the assistant to check the remote Python environment.']
  ]},
  account: {title:['配置账号','Configure account'], targets:[
    ['login-method','选择登录方式，再按页面提示登录。','Choose a sign-in method here, then follow the instructions.'],
    ['login-region','选择账号所在地区，再开始设备授权登录。','Choose the region of your account before starting device sign-in.'],
    ['api-key','在此输入服务商的 API Key，再保存配置。','Enter the provider’s API key here, then save the configuration.'],
    ['api-profile','打开已保存的服务商配置，核对地址和模型。','Open the saved provider to review its endpoint and model.'],
    ['add-api','从这里添加服务商，选择与你的订阅相符的配置。','Add a provider here, then choose the preset for your subscription.']
  ]},
  wsl: {title:['选择 WSL 发行版','Choose a WSL distribution'], targets:[
    ['wsl-distribution','在这里选择已安装的发行版，再核对下方连接范围。','Choose an installed distribution here, then review the connection scope below.'],
    ['wsl-review','核对页面上的连接信息。需要重新读取时，点击这里。','Review the connection information. Use this button to read it again.']
  ]},
  'choose-wsl': {title:['选择本地连接','Choose a local connection'], targets:[
    ['saved-wsl','使用这条已保存的连接，或在上方添加其他发行版。','Use this saved connection, or add another distribution above.'],
    ['add-wsl','点击这里添加本机的 WSL 发行版。','Add a WSL distribution on this computer here.']
  ]},
  'choose-ssh': {title:['配置 SSH 连接','Set up SSH'], targets:[
    ['saved-ssh','从这里登录已保存的远程资源。','Use this button to sign in to the saved remote resource.'],
    ['add-ssh','点击这里添加集群，填写主机和用户名。','Add the cluster here, then enter its hostname and username.']
  ]}
};

export function guideStep(step: GuideStep, english: boolean, shortCase?: string) {
  const {title,targets}=steps[step];
  let heading=title[english?1:0];
  if(step==='short-check'){
    const name=shortCase==='reference-md'?'ASE · CPU MD':shortCase==='pydyn-md'?'PyDyn · CUDA MD':english?'job service':'作业服务';
    heading=english?`Prepare the ${name} check`:`准备 ${name} 短例`;
  }
  return {heading,targets:targets.map(([id,zh,en])=>({id,hint:english?en:zh}))};
}
