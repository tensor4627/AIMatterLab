"""Editorial policy for classifying source-level diagnostic sites in the 0.1.13 audit."""

import re


categories = {
    "实际运行前提": ["input", "runtime", "compat", "protocol", "install"],
    "主动产品约束": ["identity", "authority", "integrity", "scoped-stop"],
    "运行前提与约束并存": ["cpu", "service", "authn", "budget", "uncertain", "science", "draft", "selection", "monitor"],
    "观察、状态或转述": ["state", "observation", "forward", "presentation"],
    "须结合调用者判断": ["contract"],
}


# Family, design decision and recovery instructions shared by the individual source rows.
decisions = {
    "cpu": ["实际资源前提与旧约束", "按执行单元放宽", "本地固定 CPU 检查和数密度分析只核验真正使用的资源。GPU 路线继续核对设备授权，集群另核配额。"],
    "scoped-stop": ["停止计划的操作权", "收紧授权与回执", "桌面可保存人工离线停止意图。会话请求须经其自己的通道；送达不明时读取原计划。按原项目、父作业和作用域核实回执。"],
    "monitor": ["有限次计划与原作业观察", "分开显示回执与余额", "在原服务核对计划、委托额度、父作业和本次观察。耗尽时提醒用户，手动查询不续期。"],
    "service": ["服务就绪与项目授权", "区分运行前提与许可", "在原连接核对登记、服务能力、目录请求和项目授权。按缺项恢复服务、显式更新或由用户处理权限。"],
    "identity": ["身份、绑定与版本一致性", "保留拒绝", "重读原会话、服务、资源或版本回执。只在身份重新吻合后处理当前操作；同时保留其他会话与资源。"],
    "authority": ["操作授权与私有数据范围", "保留拒绝", "核对操作方、项目范围和本次用户委托。需扩大权限时回到可信用户入口。"],
    "integrity": ["文件边界与不可变证据", "保留拒绝", "核对授权根目录、真实路径、归档成员或内容摘要。从原材料准备新草稿，保留旧快照。"],
    "uncertain": ["在途、重复或回执未确认", "只核对原尝试", "使用原请求号、运行或调度身份读取结果，区分仍在途、确定失败和丢失回执。暂缓同一副作用。"],
    "budget": ["额度、容量与有界读取", "按对象保留上限", "定位触发的上限。分页读取、等待可用槽位或由用户调整额度。其他独立操作可继续。"],
    "science": ["科学输入、接口与可加载性", "保留真实消费检查", "按实际引擎、后端、模型、数据和环境核验缺项。科学验收与程序是否退出分别记录。"],
    "compat": ["当前适配器或平台能力", "仅限制该项能力", "使用已声明且可验证的当前接口。缺能力时说明支持范围或显式更新，在其他可用入口继续准备。"],
    "runtime": ["外部运行前提", "前置就绪检查", "在原目标上核对解释器、可执行文件、服务、连接或磁盘。修复缺项后重做可安全重试的一步。"],
    "input": ["输入、字段或调用协议", "在入口提前校验", "从实际字段、单位、类型、文件或协议契约定位缺项；保留草稿，使用修正后的请求。"],
    "selection": ["尚待选择或补齐的材料", "允许准备与继续编辑", "先用已提供的材料和明确选择。仍有歧义或涉及科学含义时，请用户针对该项选择。"],
    "observation": ["状态或检查结果", "保留带来源的观察", "读取该检查的范围、状态及观察时间。根据当前操作是否依赖它决定是否继续。"],
    "forward": ["转述或组合的诊断", "追溯原错误", "这里负责传递、展示或封装。按原错误码、调用者与受影响的操作核对原因。"],
    "presentation": ["诊断文案与显示分支", "追到对应发出处", "按代码、条件或实际查询结果查找同一来源的发出处。一段界面文案可以对应多条底层路径。"],
    "contract": ["具体操作的前提或内部不变量", "保留局部失败并查上游", "用所列条件及所属函数检查本次调用的前置状态和上层处理。只有调用者的证据能区分用户输入、程序缺陷或外部失败。"],
    "protocol": ["工具或服务通信契约", "保留协议拒绝", "核对协议角色、消息结构、帧边界与请求标识。畸形回复不能写成成功回执。"],
    "draft": ["流程草稿、图与保存顺序", "提前定位待办项", "保留当前草稿，核对资源生产者、端口、所选版本与已保存的输入，再准备快照。"],
    "install": ["安装与来源核验", "在配置阶段解决", "检查锁定的来源、安装位置、依赖与文件清单。从原配置恢复可复用部分，保全已有安装和运行目录。"],
    "authn": ["登录、密钥与服务商接入", "由所属入口恢复", "核对所选账号、服务商、连接及登录结果。交互认证交给用户，其他会话和作业继续。"],
    "state": ["本地状态与恢复条件", "按对象恢复", "重读本条记录与当前状态，核对保存、关闭、删除或取消回执。只恢复仍能确认的操作。"],
}


def contains(pattern, text):
    return re.search(pattern, text, re.I) is not None


def classify(row):
    path, owner, kind = row["path"], row["owner"], row["kind"]
    signal = row["signal"] + " " + str(row.get("key", ""))
    words = signal.replace("_", " ").replace("-", " ")
    if kind == "forward" or row.get("authorship") == "forwarded":
        return "forward"
    if "/platform/verification/" in path:
        return "observation"  # Explicit desktop self-checks.
    if (path.endswith("/deployment-authorization.mjs") and ("所选 GPU" in signal or "'gpu'" in signal)
            or (path.endswith(("/registrations.py", "/ProjectAuthorizationForm.tsx")) and
                contains(r"GPU IDs|填写 GPU|GPU 编号", signal))):
        return "cpu"
    if path.endswith("/managed-schedules.mjs") and any(x in owner.split(".") for x in ("status", "stop", "sendStop", "checkedRow")):
        return "scoped-stop"
    if path.endswith(("/ManagedScheduleRecords.tsx", "/monitor-attention.mjs")):
        return "monitor"
    if path.endswith(("/managed-compute-resources.mjs", "/managed-compute-services.mjs")) and contains(
            r"project grant required|worker request failed|private service unavailable|worker update required", words):
        return "service"
    if contains(r"\b(?:registration required|maintenance required|private service unavailable|worker update required)\b", words):
        return "service"
    if contains(r"untrusted (?:IPC )?sender|sender is no longer valid|worker.owned|access is denied|"
                r"do not share|protected from|forged|human.sender|human.only|not an owned|private.{0,30}(?:denied|sharing)|"
                r"browser origins are not permitted|unsafe tool argument|isolation controls", words):
        return "authority"
    if contains(r"while hashing|not a (?:bounded )?regular|linked source|unlinked directory|path resolves through|"
                r"unsafe (?:skill |workspace )?(?:path|file|directory)|namespace unsafe|undeclared redirect|link cycle|"
                r"integrity check failed|outside the fixed|untrusted signature", words):
        return "integrity"
    if contains(r"api key|ssh username|master check failed", words):
        return "authn"
    if contains(r"(?:was|is|did) not (?:confirm|acknowledge)|not replay|may still be running", words):
        return "uncertain"
    if contains(r"not bound to|restore .*original|owner differs|not verified|differs from|does not match|not match|"
                r"not in version|mapping changed|changed (?:its|during|source)|与.{0,24}不符|不匹配|不属于", words):
        return "identity"
    if contains(r"\b(?:output|byte|skill|request|connection|refresh|size|session|resource) limit\b|execution credits", words):
        return "budget"
    if contains(r"ended inside an event|stream (?:error|receipt)|after its final|returned non.text|"
                r"did not return a real conversation|writeHead\((?:400|404|405|413)", words):
        return "protocol"
    if contains(r"checksum|hash (?:mismatch|changed|conflict|unavailable)|integrity (?:failed|mismatch)|"
                r"not regular|outside (?:the )?(?:package|allowed|registered)|immutable|canonical (?:path|root)|"
                r"absolute (?:package|input|output|workspace|registered)|workspace marker|软链接|不可变|根目录", words):
        return "integrity"
    if contains(r"credential|authentication|authenticat(?:ed|e)|human auth|known hosts|host (?:key|trust)|login (?:required|failed)|"
                r"HTTP.{0,20}(?:401|403)|(?:密钥|验证码|登录|指纹确认)|续登", words) and not contains(r"wrong (?:source|owner)|scope changed", words):
        return "authn"
    if contains(r"not permitted|human owned|agent owned|human action|human confirmation|"
                r"main.owned|desktop.only|desktop.*channel required|read.only|explicit (?:user|human)|share grant|"
                r"does not own|同意|只读|私有.{0,10}(?:范围|分享)|越权", words):
        return "authority"
    if contains(r"completion receipt|was not confirmed|not replay|may still be running|may be running|"
                r"(?:attempt|recovery|receipt|operation|request|launch|cancel|stop).{0,10}(?:pending|unknown|unconfirmed)"
                r"|terminal service active|result\(['\"]unknown['\"]|status\s*[:=]\s*['\"]unknown['\"]|已发送|送达", words):
        return "uncertain"
    if contains(r"hash mismatch|mismatched|revision changed|original receipt|cannot verify|(?:requested|expected|saved) (?:binding|fingerprint)|"
                r"exact (?:id|run|target|owner|service|source)|(?:profile|request|asset|binding|worker|project|target|snapshot|workflow|terminal|conversation|plan)"
                r".{0,50}(?:changed|replaced|differs)|(?:已变化|发生变化|读回原|来源不明)", words):
        return "identity"
    if contains(r"byte limit|\brequest limit|rate limit|\bbounded\b.{0,20}(?:size|bytes)|\btoo deep|exceeds|字节上限|数量上限", words):
        return "budget"
    if contains(r"protocol failed|frame|jsonrpc|json.rpc|HTTP (?:method|request)|(?:malformed|invalid) (?:rpc|protocol|http)|"
                r"message shape|non.text content|missing response id|协议帧|协议格式", words):
        return "protocol"
    if contains(r"(?:unsupported|incompatible|mismatch).{0,18}(?:aoti|torchscript)|(?:aoti|torchscript).{0,25}(?:incompatible|mismatch)", words):
        return "science"
    if contains(r"symlink|realpath|traversal|symbolic link|junction|reparse|outside.{0,25}(?:root|workspace|directory)|path escape|"
                r"sha256|checksum|digest|manifest hash|snapshot.{0,16}(?:differs|changed|match)|immutable|篡改|符号链接|哈希|摘要", words):
        return "integrity"
    if contains(r"unauthori|not authori|permission|not allowed|forbidden|access denied|credential|secret|private (?:data|cv|source|task)|"
                r"human (?:intent|approval|only)|delegation required|grant required|capability token|scope denied|not shared|"
                r"authorized (?:root|project|resource)|授权|权限|凭据|操作权|用户委托", words):
        return "authority"
    if contains(r"unconfirmed|(?:state|delivery|attempt|receipt|outcome|result) unknown|submission uncertain|in progress|already (?:submitted|running)|"
                r"duplicate (?:attempt|submit)|reconcil|not resubmit|idempoten|待核对|未确认|尚未确认|核对原(?:尝试|作业|提交)|重复提交", words):
        return "uncertain"
    if contains(r"\bidentity\b|context changed|scope changed|owner changed|(?:revision|version|source|target|lease|profile|selection|service|connection|"
                r"generation|session|turn|workflow|resource|input).{0,22}(?:changed|mismatch|different|stale)|does not belong|belong[s]? to|"
                r"original (?:worker|source|service|workflow|run)|身份|版本(?:已|发生)?变化|来源.{0,10}(?:不符|变化|不同)|修订.{0,5}(?:过期|变化)", words):
        return "identity"
    if contains(r"\b(?:quota|budget|capacity|oversized|too (?:many|large|long)|limit exceeded|session limit|request limit|read limit|"
                r"size limit|concurrency limit|bounded (?:read|log)|at most)\b|exceeds.{0,16}limit|额度|次数上限|容量|并发上限|超过.{0,9}上限", words):
        return "budget"
    if contains(r"\b(?:finite difference|virial|force|trajectory|tensor|tensorial|atoms?|atomistic|collective variable|kernel capacity|"
                r"cutoff|metad|opes|walker|torchscript|aoti|model species|precision|chemical species|lattice|thermo|cv size)\b|"
                r"结构文件|数密度|轨迹|力场|偏置|集体变量|物种|有限差分", words):
        return "science"
    if contains(r"unsupported|not supported|not implemented|unimplemented|incompatible|unavailable on|adapter required|worker update required|"
                r"不支持|尚未(?:接入|实现|支持)|不兼容|当前版本.{0,10}更新", words):
        return "compat"
    if contains(r"not found|does not exist|missing (?:module|dependency|interpreter|executable)|executable.{0,16}(?:required|missing)|"
                r"offline|disconnected|unavailable|refused|not installed|not connected|timed? out|timeout|connection reset|ECONN|ENOENT|"
                r"spawn failed|exited|connection failed|authentication required|无法连接|未连接|不可用|未安装|未就绪|超时|已退出", words):
        return "runtime"
    if contains(r"invalid|malformed|unknown (?:method|tool|field|parameter|command|action|option|type)|required (?:field|input)|"
                r"must (?:be|contain|include|have)|nonnegative|positive integer|unexpected (?:field|argument)|schema|parse|format|"
                r"无效|格式|整数|必须为|必需文件|缺少|字段|参数冲突", words):
        return "input"
    if contains(r"select|choose|choice|please provide|need.{0,15}(?:input|information)|请(?:先|选择|提供|填写)|待补充|请选择", words):
        return "selection"
    if contains(r"requested.*before connecting|register (?:an? |the )?(?:available|target|external|absolute)|"
                r"connect .*first|connect and prepare|probe failed|no module observations|not a (?:directory|file)|"
                r"not ready|未返回可用|准备.*工作区|未通过连接检查|服务未返回|工具清单尚未取得", words):
        return "runtime"
    if contains(r"service (?:busy|active|stopping)|(?:profile|channel|environment|session) in use|"
                r"stop the current reply|no longer active|close the current|session expired|edit busy|no changes|正在使用", words):
        return "state"
    if contains(r"\busage:|\bmissing\b|not a scalar|must identify|请输入|参数尚未补齐|取值范围|未补齐|ValidateSet\(", words):
        return "input"
    if kind in {"catalog", "ui"}:
        return "presentation"
    if kind in {"warning", "status"} or contains(r"not run|warning|no evidence|skipped|未验证|建议|尚无|尚未检查", words):
        return "observation"
    if contains(r"^raise _Stop|^return False$|^Error\(\)$|^raise ValueError\(\)|^\s*fail\(\)\s*$", signal.strip()):
        # These can be local sentinels. Inspect the guard and the specific owner before
        # advising a user to request permission or change a scientific setting.
        if path.endswith(("ssh_service_bridge.py", "existing-worker.mjs")):
            return "identity"
        if "handoff" in path or "private-cv-access" in path:
            return "authority"
        if path.endswith("cell_derivative_contract.py"):
            return "science"
        if path.endswith("ssh_auth_pty.py") and "_Stop" in signal:
            return "observation"
        return "contract"
    if contains(r"\b(?:wrong|unrecognized|incomplete|unknown|bad|only|requires?|required|expected|empty|"
                r"ambiguous|conflict|duplicate|non.empty|cannot contain|cannot be)\b|不完整|不能为空|缺项|重复|内容为空", words):
        if contains(r"(?:roadmap|workflow|authoring|draft|flow graph|dependency|cycle)|草稿|流程图", words):
            return "draft"
        if contains(r"install|bootstrap|package|download|资源文件|安装", words):
            return "install"
        if contains(r"\b(?:cv|scalar|vector|graph renderer|kernel|model mode|pbc|extxyz|finite|tensor|numerical)\b", words):
            return "science"
        return "input"
    if contains(r"(?:load|read|open|write|store|save|connect|install|register|resolve|启动|读取|保存|连接).{0,32}(?:failed|失败)|"
                r"cannot .{0,12}(?:read|open|write|save|connect|resolve)|无法(?:启动|获取|保存|读取)|未能(?:连接|读取)"
                r"|service failed|文件不存在|closed unexpectedly|did not close", words):
        return "runtime"
    if contains(r"cancelled|already |deleted|closed|superseded|finished|not active|not running|已(?:关闭|取消|删除|取回|结束)|已保存的|"
                r"未保存|重新读取|重新选择|过期|recovery required", words):
        return "state"
    file = path.rsplit("/", 1)[-1]
    if kind == "exit" or kind in ("result", "error_code") and contains(r"\bstatus\b|\bvalid\b|\bphase\b", words):
        return "observation"
    if "private-cv-access" in path or "composition-authority" in path or file.startswith("provider-scope"):
        return "authority"
    if "local-review" in path or "roadmap" in path or file in ("task-stage.mjs", "task-records.mjs"):
        return "draft"
    if file.startswith(("pygas", "custom_formula", "custom_cv", "cell_derivative", "derivative_", "neb_check", "science_check", "scientific")):
        return "science"
    if file.startswith(("package-", "tool-package", "tool-group", "group_contract", "package_contract", "stage-", "one_prompt")):
        return "install"
    if file.startswith(("windows-release-signature", "update-blocks", "package-runtime", "aimlab-source", "source-start")):
        return "install"
    if file in ("task-authoring-binding.mjs", "consumer-target-identity.mjs", "run_environment_identity.py", "source_git_identity.py"):
        return "identity"
    if file in ("launch_protocol.py", "terminal-recovery.mjs"):
        return "uncertain"
    if file in ("task-pygas.mjs", "task-consumer-stage.mjs", "task-consumer-review.mjs"):
        return "draft"
    if file.startswith(("ssh_auth", "native-ssh")) and "login" in owner.lower():
        return "authn"
    if file in ("http_handler.py", "mcp.py", "ssh_service_bridge.py", "relay.py"):
        return "protocol"
    return "contract"
