/**
 * AliTtsService 类
 * 基于阿里云CosyVoice语音合成WebSocket API实现
 * 参考文档：https://help.aliyun.com/zh/model-studio/cosyvoice-websocket-api
 * https://github.com/aliyun/alibabacloud-bailian-speech-demo/blob/master/samples/gallery/cosyvoice-js/cosyvoice_api.js
 */

import { BaseWebSocketService, WebSocketMessage, ServiceConfig } from "./BaseWebSocketService";

const DEFAULT_VOICE = 'loongcindy_v2';

// 定义配置选项类型
export interface TtsConfig {
  model: string;         // 模型名称
  task_group: string;    // 任务组，默认为 audio
  task: string;          // 任务类型，默认为tts
  function: string;      // 函数名称，默认为SpeechSynthesizer
  input: any;
  parameters: any;
}

/**
 * 进行语音合成时：
 * 每个模型（model）仅支持一组特定的音色（voice），不能将一个模型的音色与另一个模型混用
 * 待合成文本（text）必须在所选音色支持的语言范围内，否则可能出现发音错误或不自然
 * 对于支持SSML的音色，如需使用SSML功能，请参见SSML标记语言介绍，在请求参数text中填写符合SSML规范的内容
 * 对于支持Instruct的音色，如需使用Instruct功能，请在请求参数instruction中填写符合Instruct格式要求的文本
 * 对于支持时间戳的音色，如需使用时间戳功能，请通过请求参数word_timestamp_enabled（Java SDK中为enableWordTimestamp）开启该功能 
*/

/** 
 * 官方文档里不同版本有些音色，我们只选择高版本的。
 * 所以该列表里，高版本最新的音色全部都有，低版本的去掉重复的，高版本里没有的，比如日语、韩语、方言等音色补充进来。
*/
export const YinseOptions = {
  // cosyvoice-v3-flash, cosyvoice-v3-plus(only 2)音色列表
  "longanyang": 
  {
    "name": "龙安洋",
    "attr": "阳光大男孩",
    "age": "20~30岁",
    "langs": ["zh"],
    "models": ["cosyvoice-v3-flash", "cosyvoice-v3-plus"],
    "scens": "社交陪伴（标杆音色）",
    "ssml": true,
    "instruct": true,
    "timestamp": false,
  },
  "longanhuan": 
  {
    "name": "龙安欢",
    "attr": "欢脱元气女",
    "age": "20~30岁",
    "langs": ["zh"],
    "models": ["cosyvoice-v3-flash", "cosyvoice-v3-plus"],
    "scens": "社交陪伴（标杆音色）",
    "ssml": true,
    "instruct": true,
    "timestamp": false,
  },
  "longhuhu_v3": 
  {
    "name": "龙呼呼",
    "attr": "天真烂漫女童",
    "age": "6~10岁",
    "langs": ["zh"],
    "models": ["cosyvoice-v3-flash"],
    "scens": "童声（标杆音色）",
    "ssml": true,
    "instruct": true,
    "timestamp": false,
  },
  "longyingmu_v3":
  {
    "name": "龙应沐",
    "attr": "优雅知性女",
    "age": "20~30岁",
    "langs": ["zh"],
    "models": ["cosyvoice-v3-flash"],
    "scens": "电话助手",
    "ssml": true,
    "instruct": false,
    "timestamp": false,
  },
  "longyingxiao_v3":
  {
    "name": "龙应笑",
    "attr": "清甜推销女",
    "age": "20~30岁",
    "langs": ["zh"],
    "models": ["cosyvoice-v3-flash"],
    "scens": "电话销售",
    "ssml": true,
    "instruct": false,
    "timestamp": false,
  },
  "longyingxun_v3":
  {
    "name": "龙应询",
    "attr": "年轻青涩男",
    "age": "20~25岁",
    "langs": ["zh"],
    "models": ["cosyvoice-v3-flash"],
    "scens": "电话客服",
    "ssml": true,
    "instruct": false,
    "timestamp": false,
  },
  "longyingjing_v3":
  {
    "name": "龙应静",
    "attr": "低调冷静女",
    "age": "20~30岁",
    "langs": ["zh"],
    "models": ["cosyvoice-v3-flash"],
    "scens": "客服",
    "ssml": true,
    "instruct": false,
    "timestamp": true,
  },
  "longyingling_v3":
  {
    "name": "龙应聆",
    "attr": "温和共情女",
    "age": "20~30岁",
    "langs": ["zh"],
    "models": ["cosyvoice-v3-flash"],
    "scens": "客服",
    "ssml": true,
    "instruct": false,
    "timestamp": true,
  },
  "longyingtao_v3":
  {
    "name": "龙应桃",
    "attr": "温柔淡定女",
    "age": "25~30岁",
    "langs": ["zh"],
    "models": ["cosyvoice-v3-flash"],
    "scens": "客服",
    "ssml": true,
    "instruct": false,
    "timestamp": false,
  },
  "longanyun_v3":
  {
    "name": "龙安昀",
    "attr": "居家暖男",
    "age": "30~35岁",
    "langs": ["zh"],
    "models": ["cosyvoice-v3-flash"],
    "scens": "语音助手",
    "ssml": true,
    "instruct": false,
    "timestamp": false,
  },
  "longanwen_v3":
  {
    "name": "龙安温",
    "attr": "优雅知性女",
    "age": "25~35岁",
    "langs": ["zh"],
    "models": ["cosyvoice-v3-flash"],
    "scens": "语音助手",
    "ssml": true,
    "instruct": false,
    "timestamp": false,
  },
  "longanli_v3":
  {
    "name": "龙安莉",
    "attr": "利落从容女",
    "age": "25~35岁",
    "langs": ["zh"],
    "models": ["cosyvoice-v3-flash"],
    "scens": "语音助手",
    "ssml": true,
    "instruct": false,
    "timestamp": false,
  },
  "longanlang_v3":
  {
    "name": "龙安朗",
    "attr": "清爽利落男",
    "age": "20~25岁",
    "langs": ["zh"],
    "models": ["cosyvoice-v3-flash"],
    "scens": "语音助手",
    "ssml": true,
    "instruct": false,
    "timestamp": false,
  },
  "longanrou_v3":
  {
    "name": "龙安柔",
    "attr": "温柔闺蜜女",
    "age": "20~30岁",
    "langs": ["zh"],
    "models": ["cosyvoice-v3-flash"],
    "scens": "陪伴闲聊",
    "ssml": true,
    "instruct": false,
    "timestamp": true,
  },
  "longhan_v3":
  {
    "name": "龙寒",
    "attr": "温暖痴情男",
    "age": "20~30岁",
    "langs": ["zh"],
    "models": ["cosyvoice-v3-flash"],
    "scens": "陪伴闲聊",
    "ssml": true,
    "instruct": false,
    "timestamp": true,
  },
  "longanzhi_v3":
  {
    "name": "龙安智",
    "attr": "睿智轻熟男",
    "age": "25~35岁",
    "langs": ["zh"],
    "models": ["cosyvoice-v3-flash"],
    "scens": "陪伴闲聊",
    "ssml": true,
    "instruct": false,
    "timestamp": false,
  },
  "longanling_v3":
  {
    "name": "龙安灵",
    "attr": "思维灵动女",
    "age": "20~30岁",
    "langs": ["zh"],
    "models": ["cosyvoice-v3-flash"],
    "scens": "陪伴闲聊",
    "ssml": true,
    "instruct": false,
    "timestamp": true,
  },
  "longanya_v3":
  {
    "name": "龙安雅",
    "attr": "高雅气质女",
    "age": "25~35岁",
    "langs": ["zh"],
    "models": ["cosyvoice-v3-flash"],
    "scens": "陪伴闲聊",
    "ssml": true,
    "instruct": false,
    "timestamp": false,
  },
  "longanqin_v3":
  {
    "name": "龙安亲",
    "attr": "亲和活泼女",
    "age": "20~25岁",
    "langs": ["zh"],
    "models": ["cosyvoice-v3-flash"],
    "scens": "陪伴闲聊",
    "ssml": true,
    "instruct": false,
    "timestamp": false,
  },
  "longwanjun_v3":
  {
    "name": "龙婉君",
    "attr": "细腻柔声女",
    "age": "20~30岁",
    "langs": ["zh"],
    "models": ["cosyvoice-v3-flash"],
    "scens": "有声书",
    "ssml": true,
    "instruct": false,
    "timestamp": false,
  },
  "longyichen_v3":
  {
    "name": "龙逸尘",
    "attr": "洒脱活力男",
    "age": "20~30岁",
    "langs": ["zh"],
    "models": ["cosyvoice-v3-flash"],
    "scens": "有声书",
    "ssml": true,
    "instruct": false,
    "timestamp": false,
  },
  "longlaobo_v3":
  {
    "name": "龙老伯",
    "attr": "沧桑岁月爷",
    "age": "60岁以上",
    "langs": ["zh"],
    "models": ["cosyvoice-v3-flash"],
    "scens": "有声书",
    "ssml": true,
    "instruct": false,
    "timestamp": false,
  },
  "longlaoyi_v3":
  {
    "name": "龙老姨",
    "attr": "烟火从容阿姨",
    "age": "60岁以上",
    "langs": ["zh"],
    "models": ["cosyvoice-v3-flash"],
    "scens": "有声书",
    "ssml": true,
    "instruct": false,
    "timestamp": false,
  },
  "longjiqi_v3":
  {
    "name": "龙机器",
    "attr": "呆萌机器人",
    "age": "不限",
    "langs": ["zh"],
    "models": ["cosyvoice-v3-flash"],
    "scens": "短视频配音",
    "ssml": true,
    "instruct": false,
    "timestamp": false,
  },
  "longhouge_v3":
  {
    "name": "龙猴哥",
    "attr": "经典猴哥",
    "age": "不限",
    "langs": ["zh"],
    "models": ["cosyvoice-v3-flash"],
    "scens": "短视频配音",
    "ssml": true,
    "instruct": false,
    "timestamp": false,
  },
  "longdaiyu_v3":
  {
    "name": "龙黛玉",
    "attr": "娇率才女音",
    "age": "15~25岁",
    "langs": ["zh"],
    "models": ["cosyvoice-v3-flash"],
    "scens": "短视频配音",
    "ssml": true,
    "instruct": false,
    "timestamp": false,
  },
  // 方言
  "longanyue_v3":
  {
    "name": "龙安粤",
    "attr": "欢脱粤语男",
    "age": "20~30岁",
    "langs": ["yue"],
    "models": ["cosyvoice-v3-flash"],
    "scens": "短视频配音",
    "ssml": true,
    "instruct": false,
    "timestamp": false,
  },
  "longshange_v3":
  {
    "name": "龙陕哥",
    "attr": "原味陕北男",
    "age": "30~40岁",
    "langs": ["sn"],
    "models": ["cosyvoice-v3-flash"],
    "scens": "短视频配音",
    "ssml": true,
    "instruct": false,
    "timestamp": false,
  },
  "longanmin_v3":
  {
    "name": "龙安闽",
    "attr": "清纯萝莉女",
    "age": "18~25岁",
    "langs": ["mn"],
    "models": ["cosyvoice-v3-flash"],
    "scens": "短视频配音",
    "ssml": true,
    "instruct": false,
    "timestamp": false,
  },
  "longanxuan_v3":
  {
    "name": "龙安宣",
    "attr": "经典直播女",
    "age": "30~40岁",
    "langs": ["zh"],
    "models": ["cosyvoice-v3-flash"],
    "scens": "直播带货",
    "ssml": true,
    "instruct": false,
    "timestamp": false,
  },
  "loongbella_v3":
  {
    "name": "Bella3.0",
    "attr": "精准干练女",
    "age": "25~30岁",
    "langs": ["zh"],
    "models": ["cosyvoice-v3-flash"],
    "scens": "新闻播报",
    "ssml": true,
    "instruct": false,
    "timestamp": false,
  },



  // cosyvoice-v2音色列表

  // 儿童
  "longwangwang":
  {
    "name": "龙汪汪",
    "attr": "台湾少年音",
    "age": "6~10岁",
    "langs": ["zh"],
    "models": ["cosyvoice-v2"],
    "scens": "",
    "ssml": true,
    "instruct": false,
    "timestamp": true,
  },
  "longpaopao":
  {
    "name": "龙泡泡",
    "attr": "飞天泡泡音",
    "age": "6~10岁",
    "langs": ["zh"],
    "models": ["cosyvoice-v2"],
    "ssml": true,
    "instruct": false,
    "timestamp": true,
  },
  "longshanshan":
  {
    "name": "龙闪闪",
    "attr": "戏剧化童声",
    "age": "6~10岁",
    "langs": ["zh"],
    "models": ["cosyvoice-v2"],
    "ssml": true,
    "instruct": false,
    "timestamp": true,
  },
  "longniuniu":
  {
    "name": "龙牛牛",
    "attr": "阳光男童声",
    "age": "6~10岁",
    "langs": ["zh"],
    "models": ["cosyvoice-v2"],
    "ssml": true,
    "instruct": false,
    "timestamp": true,
  },
  // 童声
  "longjielidou_v2":
  {
    "name": "龙杰力豆",
    "attr": "阳光顽皮男",
    "age": "0~6岁",
    "langs": ["zh"],
    "models": ["cosyvoice-v2"],
    "ssml": true,
    "instruct": false,
    "timestamp": true,
  },
  "longling_v2":
  {
    "name": "龙铃",
    "attr": "稚气呆板女",
    "age": "0~6岁",
    "langs": ["zh"],
    "models": ["cosyvoice-v2"],
    "ssml": true,
    "instruct": false,
    "timestamp": true,
  },
  "longke_v2":
  {
    "name": "龙可",
    "attr": "懵懂乖乖女",
    "age": "0~6岁",
    "langs": ["zh"],
    "models": ["cosyvoice-v2"],
    "ssml": true,
    "instruct": false,
    "timestamp": true,
  },
  "longxian_v2":
  {
    "name": "龙仙",
    "attr": "豪放可爱女",
    "age": "0~6岁",
    "langs": ["zh"],
    "models": ["cosyvoice-v2"],
    "ssml": true,
    "instruct": false,
    "timestamp": true,
  },
  
  // 方言
  "longlaotie_v2":
  {
    "name": "龙老铁",
    "attr": "古早味男",
    "age": "东北直率男",
    "langs": ["db"],
    "models": ["cosyvoice-v2"],
    "scens": "方言",
    "ssml": true,
    "instruct": false,
    "timestamp": true,
  },
  "longjiayi_v2":
  {
    "name": "龙嘉怡",
    "attr": "知性粤语女",
    "age": "20~30岁",
    "langs": ["yue"],
    "models": ["cosyvoice-v2"],
    "scens": "方言",
    "ssml": true,
    "instruct": false,
    "timestamp": true,
  },
  "longtao_v2":
  {
    "name": "龙桃",
    "attr": "积极粤语女",
    "age": "20~30岁",
    "langs": ["yue"],
    "models": ["cosyvoice-v2"],
    "scens": "方言",
    "ssml": true,
    "instruct": false,
    "timestamp": true,
  },
  // 外语
  "loongyuuna_v2":
  {
    "name": "Yuuna",
    "attr": "元气霓虹女",
    "age": "20~30岁",
    "langs": ["ja"],
    "models": ["cosyvoice-v2"],
    "scens": "出海营销",
    "ssml": true,
    "instruct": false,
    "timestamp": true,
  },
  "loongyuuma_v2":
  {
    "name": "Yuuma",
    "attr": "干练霓虹男",
    "age": "20~30岁",
    "langs": ["ja"],
    "models": ["cosyvoice-v2"],
    "scens": "出海营销",
    "ssml": true,
    "instruct": false,
    "timestamp": true,
  },
  "loongtomoka_v2":
  {
    "name": "Tomoka",
    "attr": "日语女",
    "age": "20~30岁",
    "langs": ["ja"],
    "models": ["cosyvoice-v2"],
    "scens": "出海营销",
    "ssml": false,
    "instruct": false,
    "timestamp": false,
  },
  "loongtomoya_v2":
  {
    "name": "Tomoya",
    "attr": "日语男",
    "age": "20~30岁",
    "langs": ["ja"],
    "models": ["cosyvoice-v2"],
    "scens": "出海营销",
    "ssml": false,
    "instruct": false,
    "timestamp": false,
  },
  "loongjihun_v2":
  {
    "name": "Jihun",
    "attr": "阳光韩国男",
    "age": "20~30岁",
    "langs": ["ko"],
    "models": ["cosyvoice-v2"],
    "scens": "出海营销",
    "ssml": true,
    "instruct": false,
    "timestamp": false,
  },
  "loongkyong_v2":
  {
    "name": "Kyong",
    "attr": "韩语女",
    "age": "20~30岁",
    "langs": ["ko"],
    "models": ["cosyvoice-v2"],
    "scens": "出海营销",
    "ssml": false,
    "instruct": false,
    "timestamp": false,
  },
  "loongeva_v2":
  {
    "name": "Eva",
    "attr": "知性英文女",
    "age": "20~30岁",
    "langs": ["en"],
    "models": ["cosyvoice-v2"],
    "scens": "出海营销",
    "ssml": false,
    "instruct": false,
    "timestamp": false,
  },
  "loongbrian_v2":
  {
    "name": "Brian",
    "attr": "沉稳英文男",
    "age": "20~30岁",
    "langs": ["en"],
    "models": ["cosyvoice-v2"],
    "scens": "出海营销",
    "ssml": false,
    "instruct": false,
    "timestamp": false,
  },
  "loongluna_v2":
  {
    "name": "Luna",
    "attr": "英式英文女",
    "age": "20~30岁",
    "langs": ["en"],
    "models": ["cosyvoice-v2"],
    "scens": "出海营销",
    "ssml": false,
    "instruct": false,
    "timestamp": false,
  },
  "loongluca_v2":
  {
    "name": "Luca",
    "attr": "英式英文男",
    "age": "20~30岁",
    "langs": ["en"],
    "models": ["cosyvoice-v2"],
    "scens": "出海营销",
    "ssml": false,
    "instruct": false,
    "timestamp": false,
  },
  "loongemily_v2":
  {
    "name": "Emily",
    "attr": "英式英文女",
    "age": "20~30岁",
    "langs": ["en"],
    "models": ["cosyvoice-v2"],
    "scens": "出海营销",
    "ssml": false,
    "instruct": false,
    "timestamp": false,
  },
  "loongeric_v2":
  {
    "name": "Eric",
    "attr": "英式英文男",
    "age": "20~30岁",
    "langs": ["en"],
    "models": ["cosyvoice-v2"],
    "scens": "出海营销",
    "ssml": false,
    "instruct": false,
    "timestamp": false,
  },

  "loongabby_v2":
  {
    "name": "Abby",
    "attr": "美式英文女",
    "age": "20~30岁",
    "langs": ["en"],
    "models": ["cosyvoice-v2"],
    "scens": "出海营销",
    "ssml": false,
    "instruct": false,
    "timestamp": false,
  },
  "loongannie_v2":
  {
    "name": "Annie",
    "attr": "美式英文女",
    "age": "20~30岁",
    "langs": ["en"],
    "models": ["cosyvoice-v2"],
    "scens": "出海营销",
    "ssml": false,
    "instruct": false,
    "timestamp": false,
  },
  "loongcindy_v2":
  {
    "name": "Cindy",
    "attr": "美式英文女",
    "age": "20~30岁",
    "langs": ["en"],
    "models": ["cosyvoice-v2"],
    "scens": "出海营销",
    "ssml": false,
    "instruct": false,
    "timestamp": false,
  },
  "loongandy_v2":
  {
    "name": "Andy",
    "attr": "美式英文男",
    "age": "20~30岁",
    "langs": ["en"],
    "models": ["cosyvoice-v2"],
    "scens": "出海营销",
    "ssml": false,
    "instruct": false,
    "timestamp": false,
  },
  "loongdavid_v2":
  {
    "name": "David",
    "attr": "美式英文男",
    "age": "20~30岁",
    "langs": ["en"],
    "models": ["cosyvoice-v2"],
    "scens": "出海营销",
    "ssml": false,
    "instruct": false,
    "timestamp": false,
  },


  // 更多
  "longjixin":
  {
    "name": "龙机心",
    "attr": "毒舌心机女",
    "age": "20~30岁",
    "langs": ["zh"],
    "models": ["cosyvoice-v2"],
    "scens": "短视频配音",
    "ssml": true,
    "instruct": false,
    "timestamp": true,
  },
  "longgaoseng":
  {
    "name": "龙高僧",
    "attr": "得道高僧音",
    "age": "60岁以上",
    "langs": ["zh"],
    "models": ["cosyvoice-v2"],
    "scens": "短视频配音",
    "ssml": true,
    "instruct": false,
    "timestamp": true,
  },
  
  "longxiaochun_v2":
  {
    "name": "龙小淳",
    "attr": "知性积极女",
    "age": "25~35岁",
    "langs": ["zh"],
    "models": ["cosyvoice-v2"],
    "scens": "语音助手",
    "ssml": true,
    "instruct": false,
    "timestamp": true,
  },
  "longxiaoxia_v2":
  {
    "name": "龙小夏",
    "attr": "沉稳权威女",
    "age": "30~40岁",
    "langs": ["zh"],
    "models": ["cosyvoice-v2"],
    "scens": "语音助手",
    "ssml": true,
    "instruct": false,
    "timestamp": true,
  },
  "longbaizhi":
  {
    "name": "龙白芷",
    "attr": "睿气旁白女",
    "age": "25~35岁",
    "langs": ["zh"],
    "models": ["cosyvoice-v2"],
    "scens": "有声书",
    "ssml": true,
    "instruct": false,
    "timestamp": true,
  },
  "longsanshu":
  {
    "name": "龙三叔",
    "attr": "沉稳质感男",
    "age": "40~50岁",
    "langs": ["zh"],
    "models": ["cosyvoice-v2"],
    "scens": "有声书",
    "ssml": true,
    "instruct": false,
    "timestamp": true,
  },
  "longxiu_v2":
  {
    "name": "龙修",
    "attr": "博才说书男",
    "age": "30~40岁",
    "langs": ["zh"],
    "models": ["cosyvoice-v2"],
    "scens": "有声书",
    "ssml": true,
    "instruct": false,
    "timestamp": true,
  },
  "longmiao_v2":
  {
    "name": "龙妙",
    "attr": "抑扬顿挫女",
    "age": "25~35岁",
    "langs": ["zh"],
    "models": ["cosyvoice-v2"],
    "scens": "有声书",
    "ssml": true,
    "instruct": false,
    "timestamp": true,
  },
  "longyue_v2":
  {
    "name": "龙悦",
    "attr": "温暖磁性女",
    "age": "25~35岁",
    "langs": ["zh"],
    "models": ["cosyvoice-v2"],
    "scens": "有声书",
    "ssml": true,
    "instruct": false,
    "timestamp": true,
  },
  "longnan_v2":
  {
    "name": "龙楠",
    "attr": "睿智青年男",
    "age": "20~30岁",
    "langs": ["zh"],
    "models": ["cosyvoice-v2"],
    "scens": "有声书",
    "ssml": true,
    "instruct": false,
    "timestamp": true,
  },
  "longyuan_v2":
  {
    "name": "龙媛",
    "attr": "温暖治愈女",
    "age": "20~30岁",
    "langs": ["zh"],
    "models": ["cosyvoice-v2"],
    "scens": "有声书",
    "ssml": true,
    "instruct": false,
    "timestamp": true,
  },
  "longanshuo":
  {
    "name": "龙安朔",
    "attr": "干净清爽男",
    "age": "20~30岁",
    "langs": ["zh"],
    "models": ["cosyvoice-v2"],
    "scens": "社交陪伴",
    "ssml": true,
    "instruct": false,
    "timestamp": true,
  },
}

/**
 * CosyVoice语音合成模型配置
 */ 
export class CosyvoiceConfig implements TtsConfig {
  model: "cosyvoice-v2" | "cosyvoice-v3-flash" | "cosyvoice-v3-plus" = "cosyvoice-v2";
  task_group: string = "audio";
  task: string = "tts";
  function: string = "SpeechSynthesizer";
  input: any = {};
  parameters: {
    text_type: string; // 文本类型，默认值为plain
    voice: string; // 语音合成所使用的音色。支持系统音色和复刻音色
    format?: "pcm" | "wav" | "mp3" | "opus"; // 音频编码格式。
    sample_rate?: 8000 | 16000 | 22050 | 24000 | 44100 | 48000;
    volume?: number; // 取值范围：[0, 100]。50代表标准音量。音量大小与该值呈线性关系，0为静音，100为最大音量。
    rate?: number;  // 语速，取值范围：[0.5, 2.0]。1.0为标准语速，小于1.0则减慢，大于1.0则加快。
    pitch?: number; // 音高。该值作为音高调节的乘数，但其与听感上的音高变化并非严格的线性或对数关系，建议通过测试选择合适的值。取值范围：[0.5, 2.0]。1.0为音色自然音高。大于1.0则音高变高，小于1.0则音高变低。
    enable_ssml?: boolean; // 是否开启SSML支持。该参数设为 true 后，仅允许发送一次文本（只允许发送一次continue-task指令）。
    bit_rate?: number; // 取值范围：[6, 510]。音频码率（单位kbps）。音频格式为opus时，支持通过bit_rate参数调整码率。
    word_timestamp_enabled?: boolean; // 是否开启单词级时间戳。默认值为false。开启后，返回的音频数据中会包含每个单词的开始时间和结束时间。
    seed?: number; // 取值范围：[0, 65535]。生成时使用的随机数种子，使合成的效果产生变化。在模型版本、文本、音色及其他参数均相同的前提下，使用相同的seed可复现相同的合成结果
    language_hints?: string[]; // 提供语言提示，仅cosyvoice-v3-flash、cosyvoice-v3-plus支持该功能。注意：此参数为数组，但当前版本仅处理第一个元素，因此建议只传入一个值。
    instruction?: string; // 指令，仅cosyvoice-v3-flash、cosyvoice-v3-plus支持该功能。1. 指定小语种（仅限复刻音色）。2. 指定方言（仅限复刻音色）3. 指定情感、场景、角色或身份等：仅部分系统音色支持该功能，且因音色而异
    enable_aigc_tag?: boolean;  // 是否开启AIGC标签。默认值为false。注意：开启后，返回的音频数据中会包含AIGC标签，用于标识生成的音频是否包含AIGC内容。
    aigc_propagator?: string;   // 设置AIGC隐性标识中的 ContentPropagator 字段，用于标识内容的传播者。仅在 enable_aigc_tag 为 true 时生效。默认值：阿里云UID。
    aigc_propagate_id?: string; // 设置AIGC隐性标识中的 PropagateID 字段，用于唯一标识一次具体的传播行为。仅在 enable_aigc_tag 为 true 时生效。默认值：本次语音合成请求Request ID
  } = {
    text_type: "plain",
    voice: DEFAULT_VOICE,
    format: "mp3",
    sample_rate: 22050,
    volume: 50,
    rate: 1.0,
    pitch: 1.0,
    enable_ssml: false,
    bit_rate: 32,
    word_timestamp_enabled: false,
    seed: 0,
    language_hints: [],
    instruction: "",
    enable_aigc_tag: false,
    aigc_propagator: "",
    aigc_propagate_id: "",
  }
}

/**
 * 语音合成服务回调类型定义
 */
export type TtsResultCallback = (
  audioData: ArrayBuffer | null, // 音频数据，null表示结束
  metadata?: { isFinal?: boolean; timestamp?: number } // 元数据
) => void;

export type TtsErrorCallback = (
  error: Error
) => void;

export type TtsEventCallback = (
  event: "task-started" | "task-finished" | "error" | "timeout",
  data?: any
) => void;



/**
 * 语音合成服务类
 * 
 * ===== 重构说明 (v2.0) =====
 * 
 * 重构目的：分离WebSocket连接逻辑与任务消息逻辑，允许复用同一个WebSocket连接来多次发送run-task/finish-task消息对
 * 
 * API 层次设计：
 * ┌─────────────────────────────────────────────────┐
 * │ WebSocket 连接层（连接管理）                      │
 * │ connect() - 打开WebSocket连接                   │
 * │ disconnect() - 关闭WebSocket连接                │
 * │ isConnectionOpen() - 检查WebSocket连接状态       │
 * └─────────────────────────────────────────────────┘
 *                        ↓
 * ┌─────────────────────────────────────────────────┐
 * │ TTS 任务层（文本转语音任务）                      │
 * │ start() - 启动TTS任务（发送run-task）            │
 * │ stop() - 停止TTS任务（发送finish-task）          │
 * │ sendText() - 发送待合成文本                      │
 * │ isReady() - 检查任务是否就绪                     │
 * └─────────────────────────────────────────────────┘
 * 
 * 核心改进：
 * 1. connect()/disconnect() - WebSocket 连接管理
 * 2. start()/stop() - TTS 任务管理
 * 3. connect() 会自动创建连接，无需显式调用
 * 4. 支持连接复用：多个 start()/stop() 对可复用同一连接
 * 
 * 典型使用流程 - 单次任务（简单场景，向后兼容）：
 *   const tts = new AliTtsService(config);
 *   await tts.connect();            // 打开WebSocket连接并启动任务
 *   await tts.start();              // 启动TTS任务
 *   tts.sendText(text, true);       // 发送文本
 *   await tts.stop();               // 停止任务
 *   tts.disconnect();               // 关闭连接
 * 
 * 典型使用流程 - 复用连接处理多个任务（高级场景）：
 *   const tts = new AliTtsService(config);
 *   await tts.connect();            // 打开WebSocket连接，保持打开
 *   
 *   // 第一个任务
 *   await tts.start();              // 启动第一个TTS任务
 *   tts.sendText(text1, true);      // 发送文本
 *   await tts.stop();               // 停止第一个任务
 *   
 *   // 第二个任务 - 复用同一连接
 *   await tts.start();              // 启动第二个TTS任务
 *   tts.sendText(text2, true);      // 发送文本
 *   await tts.stop();               // 停止第二个任务
 *   
 *   // 最后关闭连接
 *   tts.disconnect();               // 关闭连接
 */
export class AliTtsService extends BaseWebSocketService {
  protected config: TtsConfig;

  private isTaskFinished: boolean = false;
  private isAudioEndNotified: boolean = false; // 标志位，避免重复发送音频结束通知
  private messageQueue: any[] = [];
  private resolveTaskFinished: ((value: void | PromiseLike<void>) => void) | null = null;
  
  // 超时管理
  private audioTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly AUDIO_TIMEOUT_MS: number = 5000; // 5秒超时
  private lastAudioReceivedTime: number = 0;
  
  // 回调函数
  private audioCallback: TtsResultCallback | null = null;
  private errorCallback: TtsErrorCallback | null = null;
  private eventCallback: TtsEventCallback | null = null;
  
  /**
   * 构造函数
   * @param config 配置选项
   */
  constructor(config: TtsConfig) {
    super(config);
    
    this.config = config;
    const voice = this.config.parameters.voice || DEFAULT_VOICE;
    const yinseConfig = (YinseOptions as any)[voice];
    if (!yinseConfig.models.includes(this.config.model)) {
      console.warn(`model ${this.config.model} is not supported by voice ${voice}! Use the right model ${yinseConfig.models[0]} instead.`);
      this.config.model = yinseConfig.models[0];
    }
    if (!yinseConfig.instruct && this.config.parameters.instruction) {
      console.warn(`instruction is not supported by voice ${voice}! will be ignored.`);
      this.config.parameters.instruction = "";
    }
    if (!yinseConfig.timestamp && this.config.parameters.word_timestamp_enabled) {
      console.warn(`timestamp is not supported by voice ${voice}! will be ignored.`);
      this.config.parameters.word_timestamp_enabled = false;
    }
  }
  
  /**
   * 获取服务名称（用于日志）
   */
  protected getServiceName(): string {
    return "tts";
  }

  /**
   * 处理 WebSocket 消息（实现抽象方法）
   */
  protected onMessage(event: MessageEvent): void {
    // 处理二进制音频流和JSON事件
    if (event.data instanceof ArrayBuffer) {
      // 处理音频数据
      this.handleAudioData(event.data);
    } else if (typeof event.data === 'string') {
      // 处理JSON事件
      try {
        const message = JSON.parse(event.data);
        // console.log("[tts] Received TTS message:", message);
        this._handleMessage(message);
      } catch (error) {
        console.error("[tts] Failed to parse TTS message:", error, "Raw message:", event.data);
        this.handleError(new Error(`[tts] Failed to parse message: ${error}`));
      }
    } else {
      console.warn("[tts] Received unexpected message type:", typeof event.data);
    }
  }

  /**
   * 重写基类的 setupSocketHandlers，添加 binaryType 设置
   */
  protected setupSocketHandlers(): void {
    if (!this.socket) return;

    // 设置二进制类型
    this.socket.binaryType = 'arraybuffer';

    // 设置事件处理器
    this.socket.onopen = () => {
      this.onConnectionOpened();
    };

    this.socket.onmessage = (event) => {
      this.onMessage(event);
    };

    this.socket.onerror = (error) => {
      this.onConnectionError(error);
    };

    this.socket.onclose = (event) => {
      // 设置 TTS 特定状态
      this.isTaskFinished = true;
      // 通知音频结束
      this.notifyAudioEnd();
      // 调用基类的 onConnectionClosed
      this.onConnectionClosed(event);
    };
  }

  /**
   * 启动TTS任务（TTS 任务层）
   * 发送 run-task 消息以启动一个新的合成任务
   * 如果WebSocket连接还没有建立，会自动调用 connect()
   * @returns Promise<void>
   */
  start(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        // 如果连接还没有建立，先建立连接
        if (!this.isConnected || !this.socket) {
          console.log('[tts] WebSocket not connected, opening connection first');
          await this.connect();
        }

        this.resolveTaskStarted = resolve;
        
        // 重置任务状态
        this.isTaskStarted = false;
        this.isTaskFinished = false;
        this.isAudioEndNotified = false; // 重置音频结束通知标志位
        this.lastAudioReceivedTime = 0;
        
        // 清除旧的超时定时器
        if (this.audioTimeoutTimer) {
          clearTimeout(this.audioTimeoutTimer);
          this.audioTimeoutTimer = null;
        }
        
        // 生成随机任务ID（使用基类的 generateUUID 方法）
        this.taskId = this.generateUUID();
        
        // 发送run-task消息
        const runTaskMessage: WebSocketMessage = {
          header: {
            action: "run-task",
            task_id: this.taskId,
            streaming: "duplex"
          },
          payload: this.config
        };
        
        this.socket?.send(JSON.stringify(runTaskMessage));
        console.log('[tts] Sent run-task message:', runTaskMessage);
      } catch (error) {
        console.error("[tts] Failed to send run-task message:", error);
        reject(error);
      }
    });
  }

  /**
   * 处理WebSocket消息
   * @private
   */
  private _handleMessage(message: any): void {
    this.handleTextMessage(message);
  }
  
  /**
   * 处理文本消息
   */
  private handleTextMessage(message: any): void {
    if (message.header?.event === "task-started") {
      this.isTaskStarted = true;
      console.log('[tts] Received task-started event');
      
      // 启动超时检测
      this.startAudioTimeout();
      
      // 通知任务开始
      this.notifyEvent("task-started");
      
      if (this.resolveTaskStarted) {
        this.resolveTaskStarted();
      }
    } else if (message.header?.event === "task-finished") {
      this.isTaskFinished = true;
      this.isTaskStarted = false;
      console.log('[tts] Received task-finished event');
      
      // 停止超时检测
      this.stopAudioTimeout();
      
      // 通知任务结束
      this.notifyEvent("task-finished");
      
      if (this.resolveTaskFinished) {
        this.resolveTaskFinished();
      }
      
      // 通知音频结束
      this.notifyAudioEnd();
    } else if (message.header?.event === "result-generated") {
      // console.log('[tts] Received result-generated event:', message.payload);
      // 处理结果生成事件（如果有）
    } else if (message.header?.event === "error") {
      console.error('[tts] Received error event:', message.payload);
      this.handleError(new Error(`[tts] TTS Service Error: ${message.payload?.message || 'Unknown error'}`));
      this.notifyEvent("error", message.payload);
    }
  }
  
  /**
   * 处理音频数据
   */
  private handleAudioData(audioData: ArrayBuffer): void {
    // 更新最后接收音频的时间
    this.lastAudioReceivedTime = Date.now();
    
    // 重置超时定时器
    this.resetAudioTimeout();
    
    if (this.audioCallback) {
      this.audioCallback(audioData, {
        isFinal: this.isTaskFinished,
        timestamp: Date.now()
      });
    }
  }
  
  /**
   * 通知音频结束
   */
  private notifyAudioEnd(): void {
    // 检查是否已经发送过结束通知，避免重复发送
    if (this.audioCallback && !this.isAudioEndNotified) {
      this.isAudioEndNotified = true;
      this.audioCallback(null, {
        isFinal: true,
        timestamp: Date.now()
      });
    }
  }
  
  /**
   * 发送待合成文本
   * @param text 待合成的文本
   * @param isFinal 是否为最终文本
   */
  sendText(text: string, isFinal: boolean = false): void {
    // 参数验证
    if (typeof text !== 'string') {
      throw new TypeError("Text must be a string.");
    }
    
    // 检查连接状态
    if (!this.isConnected || !this.isTaskStarted || !this.socket) {
      throw new Error("TTS WebSocket is not connected or task has not started.");
    }
    
    // 检查文本长度限制（根据API文档，单次发送不超过2000字符）
    if (text.length > 2000) {
      console.warn('[tts] Text length (${text.length}) exceeds recommended limit of 2000 characters.');
    }
    
    // 发送continue-task指令
    const continueTaskMessage: WebSocketMessage = {
      header: {
        action: "continue-task",
        task_id: this.taskId,
        streaming: "duplex"
      },
      payload: {
        input: {
          text: text
        }
      }
    };
    
    try {
      this.socket.send(JSON.stringify(continueTaskMessage));
      console.log('[tts] Sent continue-task message:', continueTaskMessage);
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      console.error('[tts] Failed to send continue-task message:', errorObj);
      this.handleError(new Error(`[tts] Failed to send continue-task message: ${errorObj.message}`));
      throw errorObj;
    }
    
    // 如果是最终文本，发送finish-task指令
    if (isFinal) {
      this.stop().catch(error => {
        console.error('[tts] Failed to stop TTS task:', error);
      });
    }
  }
  
  /**
   * 停止TTS任务（TTS 任务层）
   * 仅停止当前任务，不关闭WebSocket连接
   * 连接保持打开状态，可以再次调用 start() 来启动新的合成任务
   * @returns Promise<void>
   */
  stop(): Promise<void> {
    if (!this.isConnected || !this.isTaskStarted || !this.socket || !this.taskId) {
      throw new Error("TTS WebSocket is not connected or task has not started.");
    }

    return new Promise((resolve, reject) => {
      this.resolveTaskFinished = resolve;
      
      try {
        // 发送finish-task指令
        const finishTaskMessage: WebSocketMessage = {
          header: {
            action: "finish-task",
            task_id: this.taskId,
            streaming: "duplex"
          },
          payload: {
            input: {}
          }
        };
        
        this.socket?.send(JSON.stringify(finishTaskMessage));
        console.log('[tts] Sent finish-task message:', finishTaskMessage);
      } catch (error) {
        const errorObj = error instanceof Error ? error : new Error(String(error));
        console.error('[tts] Failed to send finish-task message:', errorObj);
        this.handleError(new Error(`[tts] Failed to send finish-task message: ${errorObj.message}`));
        reject(errorObj);
      }
    });
  }
  
  /**
   * 关闭WebSocket连接（WebSocket 连接层）
   * 重写基类方法以添加 TTS 特定的清理逻辑
   */
  disconnect(): void {
    // 停止超时检测
    this.stopAudioTimeout();
    
    // 调用基类的 disconnect
    super.disconnect();
    
    // 额外的 TTS 特定状态重置
    this.isTaskFinished = true;
  }

  /**
   * 关闭WebSocket连接（已废弃，请使用 disconnect()）
   * @deprecated 使用 disconnect() 替代
   */
  close(): void {
    this.disconnect();
    
    // 清理回调函数引用，避免内存泄漏
    this.audioCallback = null;
    this.errorCallback = null;
    this.eventCallback = null;
    this.resolveTaskStarted = null;
    this.resolveTaskFinished = null;
    this.messageQueue = [];
    this.lastAudioReceivedTime = 0;
  }
  
  
  /**
   * 设置音频数据回调
   * @param callback 音频数据回调函数
   */
  setAudioCallback(callback: TtsResultCallback): void {
    this.audioCallback = callback;
  }
  
  /**
   * 设置错误回调
   * @param callback 错误回调函数
   */
  setErrorCallback(callback: TtsErrorCallback): void {
    this.errorCallback = callback;
  }
  
  /**
   * 设置事件回调
   * @param callback 事件回调函数
   */
  setEventCallback(callback: TtsEventCallback): void {
    this.eventCallback = callback;
  }
  
  /**
   * 处理错误（实现抽象方法）
   */
  protected handleError(error: Error): void {
    console.error("TTS error:", error);
    if (this.errorCallback) {
      this.errorCallback(error);
    }
  }
  
  /**
   * 启动音频超时检测
   */
  private startAudioTimeout(): void {
    this.lastAudioReceivedTime = Date.now();
    this.resetAudioTimeout();
  }
  
  /**
   * 重置音频超时定时器
   */
  private resetAudioTimeout(): void {
    // 清除旧的定时器
    if (this.audioTimeoutTimer) {
      clearTimeout(this.audioTimeoutTimer);
    }
    
    // 只有在任务进行中才设置超时
    if (!this.isTaskStarted || this.isTaskFinished) {
      return;
    }
    
    // 设置新的定时器
    this.audioTimeoutTimer = setTimeout(() => {
      const timeSinceLastAudio = Date.now() - this.lastAudioReceivedTime;
      console.warn(`[tts] Audio timeout triggered. No audio received for ${timeSinceLastAudio}ms`);
      
      // 通知超时事件
      this.notifyEvent("timeout", {
        message: `No audio data received for ${this.AUDIO_TIMEOUT_MS}ms`,
        timeSinceLastAudio
      });
      
      // 关闭连接
      this.close();
    }, this.AUDIO_TIMEOUT_MS);
  }
  
  /**
   * 停止音频超时检测
   */
  private stopAudioTimeout(): void {
    if (this.audioTimeoutTimer) {
      clearTimeout(this.audioTimeoutTimer);
      this.audioTimeoutTimer = null;
    }
  }
  
  /**
   * 通知事件
   */
  private notifyEvent(event: "task-started" | "task-finished" | "error" | "timeout", data?: any): void {
    if (this.eventCallback) {
      this.eventCallback(event, data);
    }
  }
  
}
