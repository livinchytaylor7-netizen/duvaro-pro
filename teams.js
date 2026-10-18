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
  // 西甲
  "real madrid": "皇家马德里", "barcelona": "巴塞罗那", "atletico madrid": "马德里竞技",
  "athletic bilbao": "毕尔巴鄂竞技", "athletic club": "毕尔巴鄂竞技", "real sociedad": "皇家社会",
  "real betis": "皇家贝蒂斯", "villarreal": "比利亚雷亚尔", "valencia": "瓦伦西亚", "sevilla": "塞维利亚",
  "celta vigo": "塞尔塔", "celta": "塞尔塔", "ca osasuna": "奥萨苏纳", "osasuna": "奥萨苏纳",
  "getafe": "赫塔费", "rayo vallecano": "巴列卡诺", "alaves": "阿拉维斯", "deportivo alaves": "阿拉维斯",
  "espanyol": "西班牙人", "elche cf": "埃尔切", "elche": "埃尔切", "levante": "莱万特",
  "deportivo la coruna": "拉科鲁尼亚", "deportivo": "拉科鲁尼亚", "racing santander": "桑坦德竞技",
  "malaga": "马拉加", "mallorca": "马略卡", "girona": "赫罗纳", "las palmas": "拉斯帕尔马斯",
  "leganes": "莱加内斯", "real valladolid": "巴拉多利德", "valladolid": "巴拉多利德",
  "real oviedo": "皇家奥维耶多", "oviedo": "皇家奥维耶多", "granada": "格拉纳达", "almeria": "阿尔梅里亚",
  "cadiz cf": "加的斯", "cadiz": "加的斯",
};

function teamZh(name) {
  const key = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  return TEAM_ZH[key] || TEAM_ZH[key.replace(/ (fc|cf)$/, "")] || name;
}
