import {ArrowUpLeft, BookOpen} from 'lucide-react';
import type {SetupVisit} from './SetupAssistant';
import './setup-lesson.css';

type Destination = SetupVisit | 'ssh-login' | 'ssh-settings' | 'ssh-service';
export type SetupLessonLocation = {destination:Destination; shortCase?:string};

const lessons = {
  'model-test': ['测试模型连接', '连接所选助手后，发送输入框里的测试消息，查看回复。', 'Test the model connection', 'Connect your assistant, then send the test message and check its reply.'],
  assets: ['导入结构', '把资产类型选为「结构 / 轨迹」，再用文件夹按钮选择结构文件。', 'Import a structure', 'Set the asset type to Structure / trajectory, then use the folder button to choose a structure file.'],
  'tour-goal': ['描述计算目标', '读一遍输入框里的铜晶胞示例，按你的目标修改，再发给助手。', 'Describe your goal', 'Edit the copper example in the composer to say what you want to measure, then send it.'],
  runs: ['查看运行结果', '选择一条已有记录，打开日志。首次使用时，这里可能还是空的。', 'Inspect run results', 'Choose an existing run and open its log. A new workspace may have no runs yet.'],
  environments: ['登记计算环境', '连接作业服务后，点击「重新发现并登记」，查看已有环境。', 'Register an environment', 'Connect the job service, then run discovery to see your existing environments.'],
  extensions: ['获取科学工具', '展开「已验证工具的源码仓库」，找到所需工具的安装说明路径。', 'Find a scientific tool', 'Expand the list of verified source repositories to find the installation guide for your tool.'],
  'ssh-login': ['登录远程资源', '在终端完成登录，看到远端命令提示符后再继续。', 'Sign in over SSH', 'Complete sign-in in the terminal and wait for the remote shell prompt.'],
  'ssh-settings': ['配置远程连接', '选择要使用的集群配置，核对主机与登录信息。', 'Configure the remote connection', 'Choose the cluster configuration and check its host and sign-in details.'],
  'ssh-service': ['准备远程作业服务', '在对话中核对连接信息，再请助手检查远端 Python 环境。', 'Prepare the remote job service', 'Review the connection in chat, then ask the assistant to check the remote Python environment.'],
} satisfies Record<Exclude<Destination,'short-check'>, readonly [string,string,string,string]>;

export default function SetupLesson({lesson,english,onReturn}:{lesson:SetupLessonLocation; english:boolean; onReturn:()=>void}) {
  const {destination,shortCase}=lesson;
  const check=shortCase==='reference-md'?'ASE · CPU MD':shortCase==='pydyn-md'?'PyDyn · CUDA MD':english?'job service':'作业服务';
  const [title,hint,enTitle,enHint]=destination==='short-check'
    ? [`准备 ${check} 短例`, '核对所选资源，再发送草稿，让助手列出短例所需的输入。', `Prepare the ${check} check`, 'Check the selected resource, then send the draft to list the inputs.']
    : lessons[destination];
  return <button type="button" className="setup-lesson" data-testid="setup-lesson" data-lesson={destination} onClick={onReturn}
    aria-labelledby="setup-lesson-label setup-lesson-title setup-lesson-return" aria-describedby="setup-lesson-hint">
    <span className="setup-lesson-heading"><span className="setup-lesson-label" id="setup-lesson-label"><BookOpen size={15} aria-hidden="true"/>{english?'Guided tour':'新手引导'}</span>
    <strong id="setup-lesson-title">{english?enTitle:title}</strong></span>
    <span className="setup-lesson-hint" id="setup-lesson-hint">{english?enHint:hint}</span>
    <span className="setup-lesson-return" id="setup-lesson-return"><ArrowUpLeft size={14} aria-hidden="true"/>{english?'Back to guide':'返回引导'}</span>
  </button>;
}
