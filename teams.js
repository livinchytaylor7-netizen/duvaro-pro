// 球队中文名。键为去掉重音、转小写后的英文名；找不到时显示英文原名。
const TEAM_ZH = {
  // 意甲
  "ac milan": "AC米兰", "milan": "AC米兰", "atalanta bc": "亚特兰大", "atalanta": "亚特兰大",
  "bologna": "博洛尼亚", "cagliari": "卡利亚里", "como": "科莫", "fiorentina": "佛罗伦萨",
  "genoa": "热那亚", "inter milan": "国际米兰", "inter": "国际米兰", "internazionale": "国际米兰",
  "juventus": "尤文图斯", "lazio": "拉齐奥", "lecce": "莱切", "monza": "蒙扎", "napoli": "那不勒斯",
  "parma": "帕尔马", "as roma": "罗马", "roma": "罗马", "sassuolo": "萨索洛", "torino": "都灵",
  "udinese": "乌迪内斯", "venezia": "威尼斯", "frosinone": "弗罗西诺内", "empoli": "恩波利",
  "hellas verona": "维罗纳", "hellas verona fc": "维罗纳", "verona": "维罗纳", "pisa": "比萨",
  "cremonese": "克雷莫纳", "salernitana": "萨勒尼塔纳", "sampdoria": "桑普多利亚",
  "palermo": "巴勒莫", "spezia": "斯佩齐亚", "bari": "巴里",
  // 法甲
  "paris saint germain": "巴黎圣日耳曼", "paris saint-germain": "巴黎圣日耳曼", "psg": "巴黎圣日耳曼",
  "marseille": "马赛", "olympique marseille": "马赛", "lyon": "里昂", "olympique lyonnais": "里昂",
  "monaco": "摩纳哥", "as monaco": "摩纳哥", "lille": "里尔", "lille osc": "里尔", "nice": "尼斯", "ogc nice": "尼斯",
  "lens": "朗斯", "rc lens": "朗斯", "rennes": "雷恩", "stade rennais": "雷恩", "nantes": "南特", "fc nantes": "南特",
  "strasbourg": "斯特拉斯堡", "rc strasbourg": "斯特拉斯堡", "toulouse": "图卢兹", "brest": "布雷斯特", "stade brestois": "布雷斯特",
  "reims": "兰斯", "stade de reims": "兰斯", "montpellier": "蒙彼利埃", "auxerre": "欧塞尔", "aj auxerre": "欧塞尔",
  "angers": "昂热", "angers sco": "昂热", "le havre": "勒阿弗尔", "saint etienne": "圣埃蒂安", "as saint-etienne": "圣埃蒂安",
  "lorient": "洛里昂", "le mans fc": "勒芒", "le mans": "勒芒", "metz": "梅斯", "fc metz": "梅斯", "paris fc": "巴黎FC", "nimes": "尼姆", "troyes": "特鲁瓦",
  // 英冠
  "leicester city": "莱斯特城", "leicester": "莱斯特城", "southampton": "南安普顿", "ipswich town": "伊普斯维奇",
  "west bromwich albion": "西布朗", "west brom": "西布朗", "norwich city": "诺维奇", "middlesbrough": "米德尔斯堡",
  "sheffield united": "谢菲尔德联", "sheffield wednesday": "谢周三", "watford": "沃特福德", "bristol city": "布里斯托尔城",
  "millwall": "米尔沃尔", "blackburn rovers": "布莱克本", "preston north end": "普雷斯顿", "stoke city": "斯托克城",
  "swansea city": "斯旺西", "cardiff city": "卡迪夫城", "queens park rangers": "女王公园巡游者", "qpr": "女王公园巡游者",
  "hull city": "赫尔城", "coventry city": "考文垂", "derby county": "德比郡", "portsmouth": "朴茨茅斯",
  "oxford united": "牛津联", "plymouth argyle": "普利茅斯", "luton town": "卢顿", "burnley": "伯恩利",
  "leeds united": "利兹联", "sunderland": "桑德兰", "wrexham": "雷克瑟姆", "wrexham afc": "雷克瑟姆", "west ham united": "西汉姆联", "lincoln city": "林肯城", "wolverhampton wanderers": "狼队", "wolves": "狼队", "leeds": "利兹联", "brentford": "布伦特福德", "crystal palace": "水晶宫", "aston villa": "阿斯顿维拉", "newcastle united": "纽卡斯尔联", "brighton and hove albion": "布莱顿", "afc bournemouth": "伯恩茅斯", "manchester united": "曼联", "chelsea": "切尔西", "liverpool": "利物浦", "arsenal": "阿森纳", "manchester city": "曼城", "mansfield town": "曼斯菲尔德", "stockport county": "斯托克港", "doncaster rovers": "唐卡斯特", "peterborough united": "彼得堡联", "exeter city": "埃克塞特", "cambridge united": "剑桥联", "bradford city": "布拉德福德", "charlton athletic": "查尔顿",
  "birmingham city": "伯明翰", "wigan athletic": "维冈", "huddersfield town": "哈德斯菲尔德", "bolton wanderers": "博尔顿",
  "rotherham united": "罗瑟汉姆", "barnsley": "巴恩斯利", "reading": "雷丁", "blackpool": "布莱克浦",
  "nottingham forest": "诺丁汉森林", "fulham": "富勒姆", "tottenham hotspur": "托特纳姆", "everton": "埃弗顿",
  // 西甲
  "real madrid": "皇家马德里", "barcelona": "巴塞罗那", "atletico madrid": "马德里竞技",
  "athletic bilbao": "毕尔巴鄂竞技", "athletic club": "毕尔巴鄂竞技", "real sociedad": "皇家社会",
  "real betis": "皇家贝蒂斯", "villarreal": "比利亚雷亚尔", "valencia": "瓦伦西亚", "sevilla": "塞维利亚",
  "celta vigo": "塞尔塔", "celta": "塞尔塔", "ca osasuna": "奥萨苏纳", "osasuna": "奥萨苏纳",
  "getafe": "赫塔费", "rayo vallecano": "巴列卡诺", "alaves": "阿拉维斯", "deportivo alaves": "阿拉维斯",
  "espanyol": "西班牙人", "elche cf": "埃尔切", "elche": "埃尔切", "levante": "莱万特",
  "deportivo la coruna": "拉科鲁尼亚", "deportivo": "拉科鲁尼亚", "racing santander": "桑坦德竞技", "real racing club de santander": "桑坦德竞技",
  "malaga": "马拉加", "mallorca": "马略卡", "girona": "赫罗纳", "las palmas": "拉斯帕尔马斯",
  "leganes": "莱加内斯", "real valladolid": "巴拉多利德", "valladolid": "巴拉多利德",
  "real oviedo": "皇家奥维耶多", "oviedo": "皇家奥维耶多", "granada": "格拉纳达", "almeria": "阿尔梅里亚",
  "cadiz cf": "加的斯", "cadiz": "加的斯",
};

function teamZh(name) {
  const key = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  return TEAM_ZH[key] || TEAM_ZH[key.replace(/ (fc|cf)$/, "")] || name;
}
