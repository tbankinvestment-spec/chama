/**
 * Reference dataset for Kenya's 47 Counties and prominent Sub-Counties
 */
const KENYA_COUNTIES = [
  {
    code: 1,
    name: "Mombasa",
    subCounties: ["Changamwe", "Jomvu", "Kisauni", "Nyali", "Likoni", "Mvita"]
  },
  {
    code: 2,
    name: "Kwale",
    subCounties: ["Msambweni", "Lungalunga", "Matuga", "Kinango"]
  },
  {
    code: 3,
    name: "Kilifi",
    subCounties: ["Kilifi North", "Kilifi South", "Kaloleni", "Rabai", "Ganze", "Malindi", "Magarini"]
  },
  {
    code: 4,
    name: "Tana River",
    subCounties: ["Garsen", "Galole", "Bura"]
  },
  {
    code: 5,
    name: "Lamu",
    subCounties: ["Lamu East", "Lamu West"]
  },
  {
    code: 6,
    name: "Taita-Taveta",
    subCounties: ["Taveta", "Wundanyi", "Mwatate", "Voi"]
  },
  {
    code: 7,
    name: "Garissa",
    subCounties: ["Garissa Township", "Balambala", "Lagdera", "Dadaab", "Fafi", "Ijara"]
  },
  {
    code: 8,
    name: "Wajir",
    subCounties: ["Wajir North", "Wajir East", "Tarbaj", "Wajir West", "Eldas", "Wajir South"]
  },
  {
    code: 9,
    name: "Mandera",
    subCounties: ["Mandera West", "Banissa", "Mandera North", "Mandera South", "Mandera East", "Lafey"]
  },
  {
    code: 10,
    name: "Marsabit",
    subCounties: ["Moyale", "North Horr", "Saku", "Laisamis"]
  },
  {
    code: 11,
    name: "Isiolo",
    subCounties: ["Isiolo", "Merti", "Garbatulla"]
  },
  {
    code: 12,
    name: "Meru",
    subCounties: ["Igembe South", "Igembe Central", "Igembe North", "Tigania West", "Tigania East", "North Imenti", "Buuri", "Central Imenti", "South Imenti"]
  },
  {
    code: 13,
    name: "Tharaka-Nithi",
    subCounties: ["Maara", "Chuka/Igambang'ombe", "Tharaka"]
  },
  {
    code: 14,
    name: "Embu",
    subCounties: ["Manyatta", "Runyenjes", "Mbeere South", "Mbeere North"]
  },
  {
    code: 15,
    name: "Kitui",
    subCounties: ["Mwingi North", "Mwingi West", "Mwingi Central", "Kitui West", "Kitui Rural", "Kitui Central", "Kitui East", "Kitui South"]
  },
  {
    code: 16,
    name: "Machakos",
    subCounties: ["Masinga", "Yatta", "Kangundo", "Matungulu", "Kathiani", "Mavoko", "Machakos", "Mwala"]
  },
  {
    code: 17,
    name: "Makueni",
    subCounties: ["Mbooni", "Kilome", "Kaiti", "Makueni", "Kibwezi West", "Kibwezi East"]
  },
  {
    code: 18,
    name: "Nyandarua",
    subCounties: ["Kinangop", "Kipipiri", "Ol Kalou", "Ol Jorok", "Ndaragwa"]
  },
  {
    code: 19,
    name: "Nyeri",
    subCounties: ["Tetu", "Kieni", "Mathira", "Othaya", "Mukurweini", "Nyeri Town"]
  },
  {
    code: 20,
    name: "Kirinyaga",
    subCounties: ["Mwea", "Gichugu", "Ndia", "Kirinyaga Central"]
  },
  {
    code: 21,
    name: "Murang'a",
    subCounties: ["Kangema", "Mathioya", "Kiharu", "Kigumo", "Maragua", "Kandara", "Gatanga"]
  },
  {
    code: 22,
    name: "Kiambu",
    subCounties: ["Gatundu South", "Gatundu North", "Juja", "Thika Town", "Ruiru", "Githunguri", "Kiambu", "Kiambaa", "Kabete", "Kikuyu", "Limuru", "Lari"]
  },
  {
    code: 23,
    name: "Turkana",
    subCounties: ["Turkana North", "Turkana West", "Turkana Central", "Loima", "Turkana South", "Turkana East"]
  },
  {
    code: 24,
    name: "West Pokot",
    subCounties: ["Kapenguria", "Sigor", "Kacheliba", "Pokot South"]
  },
  {
    code: 25,
    name: "Samburu",
    subCounties: ["Samburu West", "Samburu North", "Samburu East"]
  },
  {
    code: 26,
    name: "Trans-Nzoia",
    subCounties: ["Kwanza", "Endebess", "Saboti", "Kiminini", "Cherangany"]
  },
  {
    code: 27,
    name: "Uasin Gishu",
    subCounties: ["Soy", "Turbo", "Moiben", "Ainabkoi", "Kapseret", "Kesses"]
  },
  {
    code: 28,
    name: "Elgeyo-Marakwet",
    subCounties: ["Marakwet East", "Marakwet West", "Keiyo North", "Keiyo South"]
  },
  {
    code: 29,
    name: "Nandi",
    subCounties: ["Tindiret", "Aldai", "Nandi Hills", "Chesumei", "Emgwen", "Mosop"]
  },
  {
    code: 30,
    name: "Baringo",
    subCounties: ["Tiaty", "Baringo North", "Baringo Central", "Baringo South", "Mogotio", "Eldama Ravine"]
  },
  {
    code: 31,
    name: "Laikipia",
    subCounties: ["Laikipia West", "Laikipia East", "Laikipia North"]
  },
  {
    code: 32,
    name: "Nakuru",
    subCounties: ["Molo", "Njoro", "Naivasha", "Gilgil", "Kuresoi South", "Kuresoi North", "Subukia", "Rongai", "Bahati", "Nakuru Town West", "Nakuru Town East"]
  },
  {
    code: 33,
    name: "Narok",
    subCounties: ["Kilgoris", "Emurua Dikirr", "Narok North", "Narok East", "Narok South", "Narok West"]
  },
  {
    code: 34,
    name: "Kajiado",
    subCounties: ["Kajiado North", "Kajiado Central", "Kajiado East", "Kajiado West", "Kajiado South"]
  },
  {
    code: 35,
    name: "Kericho",
    subCounties: ["Kipkelion East", "Kipkelion West", "Ainamoi", "Bureti", "Belgut", "Sigowet/Soin"]
  },
  {
    code: 36,
    name: "Bomet",
    subCounties: ["Sotik", "Chepalungu", "Bomet East", "Bomet Central", "Konoin"]
  },
  {
    code: 37,
    name: "Kakamega",
    subCounties: ["Lugari", "Likuyani", "Malava", "Lurambi", "Navakholo", "Mumias West", "Mumias East", "Matungu", "Butere", "Khwisero", "Shinyalu", "Ikolomani"]
  },
  {
    code: 38,
    name: "Vihiga",
    subCounties: ["Vihiga", "Sabatia", "Hamisi", "Luanda", "Emuhaya"]
  },
  {
    code: 39,
    name: "Bungoma",
    subCounties: ["Mt. Elgon", "Sirisia", "Kabuchai", "Bumula", "Kanduyi", "Webuye West", "Webuye East", "Kimilili", "Tongaren"]
  },
  {
    code: 40,
    name: "Busia",
    subCounties: ["Teso North", "Teso South", "Nambale", "Matayos", "Butula", "Funyula", "Budalangi"]
  },
  {
    code: 41,
    name: "Siaya",
    subCounties: ["Ugenya", "Ugunja", "Alego Usonga", "Gem", "Bondo", "Rarieda"]
  },
  {
    code: 42,
    name: "Kisumu",
    subCounties: ["Kisumu East", "Kisumu West", "Kisumu Central", "Seme", "Nyando", "Muhoroni", "Nyakach"]
  },
  {
    code: 43,
    name: "Homa Bay",
    subCounties: ["Kasipul", "Kabondo Kasipul", "Karachuonyo", "Rangwe", "Homa Bay Town", "Ndhiwa", "Suba North", "Suba South"]
  },
  {
    code: 44,
    name: "Migori",
    subCounties: ["Rongo", "Awendo", "Suna East", "Suna West", "Uriri", "Nyatike", "Kuria West", "Kuria East"]
  },
  {
    code: 45,
    name: "Kisii",
    subCounties: ["Bonchari", "South Mugirango", "Bomachoge Borabu", "Bobasi", "Bomachoge Chache", "Nyaribari Masaba", "Nyaribari Chache", "Kitutu Chache North", "Kitutu Chache South"]
  },
  {
    code: 46,
    name: "Nyamira",
    subCounties: ["Kitutu Masaba", "West Mugirango", "North Mugirango", "Borabu"]
  },
  {
    code: 47,
    name: "Nairobi",
    subCounties: ["Westlands", "Dagoretti North", "Dagoretti South", "Lang'ata", "Kibra", "Roysambu", "Kasarani", "Ruaraka", "Embakasi South", "Embakasi North", "Embakasi Central", "Embakasi East", "Embakasi West", "Makadara", "Kamukunji", "Starehe", "Mathare"]
  }
];

module.exports = { KENYA_COUNTIES };
