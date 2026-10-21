// 这个行业的分类体系：类别、标签词表、公司（主体）名录，以及防止张冠李戴的身份词典。
// 模型按这里的词表打标签，主题页（topics.json）按标签归类，筛选栏按类别分组。
// 换行业时：类别的 key 会出现在网址里（/all?category=…），上线后就不要再改；标签和名录可以随时增减。
//
// 双主线：汽车/新能源（新车、技术、市场、企业、政策、评测）+ 智能科技（smart-ai，海外 AI 信源的落点）。

/**
 * 网页上的类别（筛选栏、卡片角标、RSS 分类订阅）。key 是网址和接口里的身份，上线后不要改。
 * section 是日报里的分节标题（几个类别可以共用一节，按这里的顺序排）；guide 告诉结构抽取模型这一类收什么、
 * 和相邻类别的边界在哪（总的归类原则写在 prompts/structure.md 里）。
 * commentary 标出评论类（试驾、评测、观点）：日报写过的事又有评论类的后续报道，只占一行快讯（报道它的信源够多时除外）。
 * 没归上类的资料在日报里放进第一个 key 为 industry 的类别所在的节（没有就放最后一节）。
 * feedLabel 是分类 RSS 标题里的名字（不写就用 label）。公开接口、RSS 和 MCP 里要把一类并进另一类发布，写在站点设置里（site/site.ts 的 PUBLIC_CATEGORIES）。
 */
export const CATEGORIES = [
  { key: "new-car", label: "新车", feedLabel: "新车", section: "新车上市", guide: "新车、改款、预售、上市与交付节点的发布。同一车型的预告、上市、交付是同一事件的先后进展；只凭渲染图或“据悉”的传闻不算发布。" },
  { key: "tech", label: "技术", feedLabel: "技术", section: "技术发布", guide: "三电（电池、电机、电控）、固态电池、补能与换电、智能驾驶方案、智能座舱、整车平台与架构、芯片与算力、线控底盘等技术的发布与变化。技术本身的参数、路线与量产节点归这里；一辆车上市时顺带公布的技术配置归新车。" },
  { key: "market", label: "市场", feedLabel: "市场", section: "市场与销量", guide: "销量与上险量、价格与降价、出口与出海、渠道与门店、市占率与排名、行业统计。已发生的经营结果与市场变化；对市场的预测归评测观点。" },
  { key: "company", label: "企业", feedLabel: "企业", section: "企业动态", guide: "已发生的公司经营动作：融资、并购、财报、人事、合作与供应链、产能与建厂、诉讼与纠纷。新闻由当事方发帖、带有态度，也不因此变成观点。" },
  { key: "policy", label: "政策", feedLabel: "政策", section: "政策监管", guide: "政策法规、补贴与购置税、标准与准入、召回与监管处罚、双积分与碳排。监管机构的动作与要求；对政策的解读归评测观点。" },
  { key: "smart-ai", label: "智能科技", feedLabel: "智能科技", section: "智能科技", guide: "人工智能与前沿科技本身：模型、智能体、算力与芯片、机器人、具身智能，以及 AI 行业有具体产品、技术、合作或经营动作的公司动态；纯股价、行情和没有具体事实的泛论不算。海外 AI 信源的落点。" },
  { key: "review", label: "评测观点", feedLabel: "评测观点", section: "观点与评测", guide: "重点是作者的解释、判断或体验：试驾、实测、评测、榜单、访谈、行业判断、用车经验。发布产品或技术归对应类别，只有态度和预测而无实测归这里。", commentary: true },
] as const satisfies ReadonlyArray<{ key: string; label: string; feedLabel?: string; section: string; guide: string; commentary?: true }>;

/**
 * 这个行业最受关注的一类发布（汽车行业是新车上市）：日报报头的“N 款新车”、改分类后修订已出的报告都按它数。
 * category 是类别，tag 是标签，两者都对上才算；unit 接在数字后面。
 * 没有这样一类的行业设成 null，报头就不显示这个数。
 */
export const RELEASE: { category: string; tag: string; unit: string } | null = { category: "new-car", tag: "新车上市", unit: "款新车" };

/** 周报月报的总述可以直接写、不必在报道里找到出处的行业通用词（小写）。站名会自动算进去。 */
export const PLAIN_TERMS: readonly string[] = ["suv", "mpv", "hev", "phev", "erev", "bev", "l2", "l3", "l4", "kwh", "nm", "ota", "adas", "noa", "nvh", "cltc", "wltp", "v2g"];

/**
 * 内容理解一步给每篇资料判的“内容类型”（写在 prompts/content-understanding.md 里，改了类型要同步改那份提示词）。
 * 评分提示词（prompts/selection-score.md）按类型给五个维度不同的权重。
 */
export const ITEM_TYPES = ["new_car_launch", "tech_release", "market_data", "business_event", "policy_regulation", "ai_tech", "review_opinion"] as const;

// ── 标签词表 ────────────────────────────────────────────────────────────────────────────

/** 每篇资料的第一个标签必须是这些“分类标签”之一。 */
export const CATEGORY_TAGS = [
  "新车上市", "技术发布", "销量数据", "企业动态", "政策监管", "智能科技", "评测体验",
  "行业观察", "供应链", "召回/安全", "用车经验", "其他",
] as const;

/** 可选的主题标签（技术领域与概念）。 */
export const TOPIC_TAGS = [
  "纯电", "插混", "增程", "换电", "快充", "固态电池", "电池安全", "电机电控",
  "智能驾驶", "智能座舱", "整车平台", "线控底盘", "芯片算力", "热管理", "轻量化",
  "出海", "具身智能", "大模型", "人工智能", "端侧",
] as const;

/** 可选的实体标签（公司、品牌、机构）。 */
export const ENTITY_TAGS = [
  "比亚迪", "特斯拉", "蔚来", "小鹏", "理想", "小米汽车", "华为", "极氪", "长安", "吉利",
  "奇瑞", "宁德时代", "地平线", "博世", "英伟达",
] as const;

/** 模型常写的近义词，统一成词表里的写法。 */
export const TAG_SYNONYMS: Readonly<Record<string, string>> = {
  新车: "新车上市", 上市: "新车上市", 预售: "新车上市", 盲订: "新车上市", 改款: "新车上市", 换代: "新车上市", 交付: "新车上市",
  销量: "销量数据", 上险量: "销量数据", 销量榜: "销量数据", 销量排行: "销量数据", 价格: "销量数据", 降价: "销量数据", 价格战: "销量数据", 出口: "出海", 出海: "出海",
  融资: "企业动态", 收购: "企业动态", 并购: "企业动态", 财报: "企业动态", 人事: "企业动态", 合作: "企业动态", 产能: "企业动态", 建厂: "企业动态", 公司动态: "企业动态",
  政策: "政策监管", 监管: "政策监管", 法规: "政策监管", 补贴: "政策监管", 标准: "政策监管", 购置税: "政策监管", 召回: "召回/安全", 安全: "召回/安全",
  智驾: "智能驾驶", 自动驾驶: "智能驾驶", 辅助驾驶: "智能驾驶", 高阶智驾: "智能驾驶", noa: "智能驾驶", ads: "智能驾驶",
  座舱: "智能座舱", 车机: "智能座舱", 智能座舱: "智能座舱",
  电池: "技术发布", 固态: "固态电池", 固态电池: "固态电池", 快充: "快充", 换电: "换电", 三电: "技术发布", 平台: "整车平台", 架构: "整车平台",
  芯片: "芯片算力", 算力: "芯片算力", 激光雷达: "智能驾驶",
  试驾: "评测体验", 实测: "评测体验", 评测: "评测体验", 体验: "评测体验", 榜单: "评测体验",
  观点: "行业观察", 趋势: "行业观察", 现象: "行业观察", 访谈: "行业观察",
  用车: "用车经验", 保养: "用车经验", 充电: "用车经验",
  供应链: "供应链", 电池厂: "供应链",
  大模型: "大模型", ai: "人工智能", 机器人: "具身智能", 人形机器人: "具身智能", 具身: "具身智能",
  教程: "用车经验", 技巧: "用车经验", 指南: "用车经验",
};

// ── 公司与主体 ──────────────────────────────────────────────────────────────────────────

/**
 * 公司主题：id → 显示名、卡片上显示的标签（null 表示只用 entity:<id> 归类）、别名。
 * aliases 给结构抽取模型看；otherNames 是公司自己的其他称呼（子品牌、官方账号名），
 * 把事实的主体对到公司、判断标题有没有点名这家公司时也认它们。
 *
 * 这是第一批；品牌与子品牌挂在所属公司的 otherNames 下（wiki 六维里的“企业/品牌”都在这一层）。
 */
export const ENTITIES: Record<string, { name: string; displayTag: string | null; aliases: string[]; otherNames?: string[] }> = {
  // 整车
  byd: { name: "比亚迪", displayTag: "比亚迪", aliases: ["比亚迪", "BYD"], otherNames: ["王朝网", "海洋网", "腾势", "方程豹", "仰望", "弗迪"] },
  tesla: { name: "特斯拉", displayTag: "特斯拉", aliases: ["特斯拉", "Tesla"] },
  nio: { name: "蔚来", displayTag: "蔚来", aliases: ["蔚来", "NIO"], otherNames: ["乐道", "萤火虫", "蔚来能源"] },
  xpeng: { name: "小鹏汽车", displayTag: "小鹏", aliases: ["小鹏", "小鹏汽车", "XPeng"], otherNames: ["MONA", "小鹏汇天"] },
  li: { name: "理想汽车", displayTag: "理想", aliases: ["理想汽车", "理想", "Li Auto"] },
  xiaomi: { name: "小米汽车", displayTag: "小米汽车", aliases: ["小米汽车", "小米", "Xiaomi"], otherNames: ["SU7", "YU7"] },
  huawei: { name: "华为", displayTag: "华为", aliases: ["华为", "Huawei"], otherNames: ["鸿蒙智行", "问界", "AITO", "智界", "享界", "尊界", "尚界", "华为车BU"] },
  zeekr: { name: "极氪", displayTag: "极氪", aliases: ["极氪", "Zeekr"] },
  geely: { name: "吉利", displayTag: "吉利", aliases: ["吉利", "Geely"], otherNames: ["领克", "吉利银河", "几何", "极星", "沃尔沃", "路特斯"] },
  changan: { name: "长安汽车", displayTag: "长安", aliases: ["长安汽车", "长安", "Changan"], otherNames: ["深蓝", "阿维塔", "启源", "长安福特", "长安马自达"] },
  chery: { name: "奇瑞", displayTag: "奇瑞", aliases: ["奇瑞", "Chery"], otherNames: ["星途", "捷途", "iCAR", "智米", "奇瑞新能源"] },
  aion: { name: "广汽埃安", displayTag: null, aliases: ["埃安", "广汽埃安", "AION"], otherNames: ["昊铂", "广汽"] },
  leapmotor: { name: "零跑汽车", displayTag: null, aliases: ["零跑", "零跑汽车", "Leapmotor"] },
  greatwall: { name: "长城汽车", displayTag: null, aliases: ["长城汽车", "长城", "Great Wall"], otherNames: ["哈弗", "魏牌", "坦克", "欧拉", "长城炮"] },
  saic: { name: "上汽集团", displayTag: null, aliases: ["上汽", "上汽集团", "SAIC"], otherNames: ["荣威", "名爵", "MG", "智己", "飞凡", "五菱"] },
  dongfeng: { name: "东风汽车", displayTag: null, aliases: ["东风", "东风汽车"], otherNames: ["岚图", "猛士", "奕派", "纳米"] },
  faw: { name: "一汽集团", displayTag: null, aliases: ["一汽", "中国一汽", "FAW"], otherNames: ["红旗", "奔腾", "解放"] },
  baic: { name: "北汽集团", displayTag: null, aliases: ["北汽", "北京汽车", "BAIC"], otherNames: ["极狐", "享界", "北京越野"] },
  gac: { name: "广汽集团", displayTag: null, aliases: ["广汽集团", "广汽", "GAC"], otherNames: ["广汽传祺", "广汽本田", "广汽丰田"] },
  volkswagen: { name: "大众", displayTag: null, aliases: ["大众", "Volkswagen", "VW"], otherNames: ["一汽-大众", "上汽大众", "奥迪", "保时捷", "斯柯达"] },
  toyota: { name: "丰田", displayTag: null, aliases: ["丰田", "Toyota"], otherNames: ["雷克萨斯", "Lexus"] },
  bmw: { name: "宝马", displayTag: null, aliases: ["宝马", "BMW"], otherNames: ["MINI", "劳斯莱斯"] },
  mercedes: { name: "奔驰", displayTag: null, aliases: ["奔驰", "梅赛德斯", "Mercedes-Benz"], otherNames: ["迈巴赫", "AMG", "smart"] },
  gm: { name: "通用汽车", displayTag: null, aliases: ["通用汽车", "通用", "General Motors", "GM"], otherNames: ["别克", "凯迪拉克", "雪佛兰"] },
  // 供应链与智驾
  catl: { name: "宁德时代", displayTag: "宁德时代", aliases: ["宁德时代", "CATL"], otherNames: ["麒麟电池", "神行电池", "巧克力换电"] },
  horizon: { name: "地平线", displayTag: "地平线", aliases: ["地平线", "Horizon Robotics"] },
  momenta: { name: "Momenta", displayTag: null, aliases: ["Momenta"] },
  "dji-auto": { name: "卓驭科技", displayTag: null, aliases: ["卓驭", "大疆车载", "DJI Automotive"] },
  bosch: { name: "博世", displayTag: "博世", aliases: ["博世", "Bosch"] },
  hesai: { name: "禾赛科技", displayTag: null, aliases: ["禾赛", "Hesai"] },
  robo: { name: "速腾聚创", displayTag: null, aliases: ["速腾聚创", "RoboSense"] },
  // 智能科技（保留原 AI 线的落点）
  openai: { name: "OpenAI", displayTag: null, aliases: ["OpenAI", "ChatGPT", "Sora", "Codex", "GPT"], otherNames: ["OpenAI Developers"] },
  anthropic: { name: "Anthropic", displayTag: null, aliases: ["Anthropic", "Claude"], otherNames: ["Claude Code"] },
  google: { name: "Google", displayTag: null, aliases: ["Google", "DeepMind", "Gemini", "谷歌"], otherNames: ["Google DeepMind", "Google Research", "Google AI", "Google Labs", "Google Cloud", "Waymo"] },
  deepseek: { name: "DeepSeek", displayTag: null, aliases: ["DeepSeek", "深度求索"] },
  qwen: { name: "千问 Qwen", displayTag: null, aliases: ["Qwen", "通义", "阿里", "阿里巴巴", "Alibaba"], otherNames: ["通义千问", "千问", "Qwen Team", "通义实验室", "阿里云", "Alibaba Cloud"] },
  kimi: { name: "Kimi / 月之暗面", displayTag: null, aliases: ["Kimi", "月之暗面", "Moonshot"], otherNames: ["Moonshot AI"] },
  minimax: { name: "MiniMax", displayTag: null, aliases: ["MiniMax", "海螺"], otherNames: ["稀宇科技"] },
  zhipu: { name: "智谱 GLM", displayTag: null, aliases: ["智谱", "GLM", "Z.ai"], otherNames: ["智谱AI", "Zhipu", "Zhipu AI"] },
  bytedance: { name: "字节豆包", displayTag: null, aliases: ["豆包", "Doubao", "字节跳动", "ByteDance"], otherNames: ["火山引擎", "Seed", "即梦"] },
  tencent: { name: "腾讯混元", displayTag: null, aliases: ["混元", "Hunyuan", "腾讯"], otherNames: ["腾讯云", "腾讯元宝"] },
  baidu: { name: "百度文心", displayTag: null, aliases: ["百度", "Baidu", "文心", "ERNIE"], otherNames: ["文心一言", "萝卜快跑", "Apollo"] },
  meta: { name: "Meta", displayTag: null, aliases: ["Meta", "Llama"], otherNames: ["Meta AI", "AI at Meta"] },
  microsoft: { name: "Microsoft", displayTag: null, aliases: ["Microsoft", "微软", "Copilot"], otherNames: ["Microsoft Research", "Microsoft AI"] },
  nvidia: { name: "NVIDIA", displayTag: "英伟达", aliases: ["NVIDIA", "英伟达"], otherNames: ["Nemotron", "Blackwell", "CUDA", "DRIVE"] },
  qualcomm: { name: "高通", displayTag: null, aliases: ["高通", "Qualcomm"], otherNames: ["骁龙", "Snapdragon", "骁龙座舱", "骁龙智驾"] },
  mistral: { name: "Mistral AI", displayTag: null, aliases: ["Mistral", "Mistral AI"] },
  huggingface: { name: "Hugging Face", displayTag: null, aliases: ["Hugging Face", "HuggingFace"] },
  xai: { name: "xAI", displayTag: null, aliases: ["xAI", "Grok"], otherNames: ["SpaceXAI"] },
  apple: { name: "Apple", displayTag: null, aliases: ["Apple", "苹果"], otherNames: ["Apple Intelligence", "Apple CarPlay", "苹果汽车"] },
};

/**
 * 身份词典：摘要和标题里出现的公司，必须在原文里也出现过，否则退回原标题、丢掉摘要（防止模型张冠李戴）。
 * 汽车行业最容易被张冠李戴的是品牌与车系，所以只收最常被误认的几家。
 */
export const IDENTITY_LEXICON: ReadonlyArray<{ id: string; name: string; patterns: RegExp[] }> = [
  { id: "byd", name: "比亚迪", patterns: [/比亚迪|\bbyd\b|腾势|方程豹|仰望/i] },
  { id: "tesla", name: "特斯拉", patterns: [/特斯拉|\btesla\b|model\s?[3ysx]\b/i] },
  { id: "nio", name: "蔚来", patterns: [/蔚来|\bnio\b|乐道|萤火虫/i] },
  { id: "xpeng", name: "小鹏", patterns: [/小鹏|\bxpeng\b|\bmona\b/i] },
  { id: "li", name: "理想汽车", patterns: [/理想汽车|理想\s?l[6789]\b|\bli\s?auto\b/i] },
  { id: "xiaomi", name: "小米汽车", patterns: [/小米|xiaomi|\bsu7\b|\byu7\b/i] },
  { id: "huawei", name: "华为", patterns: [/华为|huawei|鸿蒙智行|问界|智界|享界|尊界|\baito\b/i] },
  { id: "geely", name: "吉利", patterns: [/吉利|geely|领克|极氪|zeekr|银河/i] },
  { id: "changan", name: "长安汽车", patterns: [/长安|changan|深蓝|阿维塔|启源/i] },
  { id: "chery", name: "奇瑞", patterns: [/奇瑞|chery|星途|捷途|\bicar\b/i] },
  { id: "catl", name: "宁德时代", patterns: [/宁德时代|\bcatl\b|麒麟电池|神行电池/i] },
  { id: "nvidia", name: "NVIDIA", patterns: [/nvidia|英伟达|\bcuda\b|\bdrive\b|\borin\b|\bthor\b/i] },
  { id: "openai", name: "OpenAI", patterns: [/openai|chatgpt|\bgpt-?[o\d]|\bsora\b|\bcodex\b/i] },
  { id: "google", name: "Google / Gemini", patterns: [/google|deepmind|\bgemini\b|\bwaymo\b|\bveo\s?\d/i] },
  { id: "anthropic", name: "Anthropic", patterns: [/anthropic|\bclaude\b/i] },
];

/** 这些域名上的文章，发布方就是对应的公司（托管平台如 GitHub、arXiv 不算）。 */
export const PUBLISHER_DOMAINS: ReadonlyArray<{ entityId: string; domains: readonly string[] }> = [
  { entityId: "byd", domains: ["byd.com", "bydauto.com.cn"] },
  { entityId: "tesla", domains: ["tesla.com", "tesla.cn"] },
  { entityId: "nio", domains: ["nio.com", "nio.cn"] },
  { entityId: "xpeng", domains: ["xiaopeng.com", "heyxpeng.com"] },
  { entityId: "li", domains: ["lixiang.com", "liauto.com"] },
  { entityId: "xiaomi", domains: ["mi.com", "xiaomiev.com"] },
  { entityId: "huawei", domains: ["huawei.com"] },
  { entityId: "zeekr", domains: ["zeekrlife.com", "zeekr.com"] },
  { entityId: "catl", domains: ["catl.com"] },
  { entityId: "horizon", domains: ["horizon.auto", "horizon.ai"] },
  { entityId: "nvidia", domains: ["nvidia.com"] },
  { entityId: "qualcomm", domains: ["qualcomm.com"] },
  { entityId: "openai", domains: ["openai.com"] },
  { entityId: "anthropic", domains: ["anthropic.com", "claude.com"] },
  { entityId: "google", domains: ["deepmind.google", "ai.google", "blog.google"] },
  { entityId: "deepseek", domains: ["deepseek.com"] },
  { entityId: "microsoft", domains: ["microsoft.com"] },
  { entityId: "meta", domains: ["ai.meta.com"] },
];

/** 原文里的这些写法也算提到了对应公司。 */
export const IDENTITY_CONTEXT_ALIASES: ReadonlyArray<{ entityId: string; pattern: RegExp }> = [
  { entityId: "byd", pattern: /@比亚迪(汽车|王朝|海洋)?\b/i },
  { entityId: "huawei", pattern: /@(鸿蒙智行|AITO汽车|华为终端)\b/i },
  { entityId: "xiaomi", pattern: /@小米汽车\b/i },
  { entityId: "nio", pattern: /@蔚来\b/i },
];
