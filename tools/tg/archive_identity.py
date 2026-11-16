"""Exact-provider identity plans for previously unmatched archive files.

No fuzzy title or season guessing. Provider metadata is cached independently of
the live writer. Default operation is read-only; --apply requires the writer
lock and creates backups before adding individual certified file bindings.
"""
import argparse
from collections import Counter, defaultdict
from email.utils import parsedate_to_datetime
import json
from pathlib import Path
import re
import sqlite3
import time
import unicodedata
import urllib.request

from season_identity import conflicts, page_markers, record_markers, season_label_has_ordinal_prefix
from archive_file_review import reviewed_record_allowed

VIDEO_EXTENSIONS = {'.mp4', '.mkv', '.webm', '.avi', '.mov', '.m4v'}
SPECIAL_FORMATS = {'OVA', 'SPECIAL'}
SPECIAL_MARKER = re.compile(r'\b(?:OVA|OAD|specials?|extras?|SP\d+)\b', re.I)
PACK = re.compile(r'(?:\b|[ _.-])(?:e(?:p)?\s*)?(\d{1,4})\s*(?:-|\+|&|to)\s*(?:e(?:p)?\s*)?(\d{1,4})\b', re.I)
SCENE_PACK = re.compile(r'\bS\d{1,2}E\d{1,4}\s*[-+&]\s*E?\d{1,4}\b', re.I)
QUERY = '''query($search:String,$page:Int){Page(page:$page,perPage:50){pageInfo{hasNextPage}
media(search:$search,type:ANIME){id idMal title{romaji english native} synonyms format episodes
season seasonYear startDate{year month day} status description(asHtml:false) genres duration
coverImage{large} studios(isMain:true){nodes{name}}}}}'''

# Reviewed literal archive aliases. ID/year/episode count AND the stated
# provider title/synonym must all agree; these are not fuzzy matching rules.
APPROVED_ALIASES = {
    'Shingeki no Kyojin Season 3': (99147,2018,12,'Shingeki no Kyojin Season 3'),
    'Shingeki no Kyojin Season 3 Part 2': (104578,2019,10,'Shingeki no Kyojin Season 3 Part 2'),
    'Bungo Stray Dogs': (21311,2016,12,'Bungou Stray Dogs'),
    'Bungou Stray Dogs 2nd Season': (21679,2016,12,'Bungou Stray Dogs 2nd Season'),
    'Bungou Stray Dogs 3rd Season': (103223,2019,12,'Bungou Stray Dogs 3rd Season'),
    '86: Eighty Six': (116589,2021,11,'86: Eighty Six'),
    '86: Eighty Six Part 2': (131586,2021,12,'86: Eighty Six Part 2'),
    'Shokugeki no Souma: San no Sara': (99255,2017,12,'Shokugeki no Souma: San no Sara'),
    'Shokugeki no Souma: San no Sara - Tootsuki Ressha-hen': (100773,2018,12,'Shokugeki no Souma: San no Sara - Tootsuki Ressha-hen'),
    'Mushoku Tensei: Isekai Ittara Honki Dasu': (108465,2021,11,'Mushoku Tensei: Isekai Ittara Honki Dasu'),
    'Mushoku Tensei: Isekai Ittara Honki Dasu Part 2': (127720,2021,12,'Mushoku Tensei: Isekai Ittara Honki Dasu Part 2'),
    'The Case Study of Vanitas': (131646,2021,12,'Vanitas no Carte'),
    'Vanitas no Carte Part 2': (135136,2022,12,'Vanitas no Carte Part 2'),
    'JoJo no Kimyou na Bouken: Stone Ocean Part 2': (146722, 2022, 26, 'JoJo no Kimyou na Bouken: Stone Ocean Part 2'),
    'Free Eternal Summer S2': (20614, 2014, 13, 'Free!: Eternal Summer'),
    'Steins Gate 0': (21127, 2018, 23, 'Steins;Gate 0'),
    'Night Head 2041': (125868, 2021, 12, 'NIGHT HEAD 2041'),
    'Night Head 2041 .': (125868, 2021, 12, 'NIGHT HEAD 2041'),
    'Night Head2041': (125868, 2021, 12, 'NIGHT HEAD 2041'),
    'Tokyo Magnitude 8.0': (6211, 2009, 11, 'Tokyo Magnitude 8.0'),
    'Baccano! Bangai-hen': (3901, 2008, 3, 'Baccano! Bangai-hen'),
    'Snowball Earth Ep:': (196144, 2026, 13, 'Snowball Earth'),
    'Mairimashita iruma-kon S3': (139092, 2022, 21, 'Welcome to Demon School! Iruma-kun Season 3'),
    'MEGUMI NO DAIGO': (158791, 2023, 23, 'Megumi no Daigo: Kyuukoku no Orange'),
    'Muscleman S2': (181886, 2025, 11, 'Kinnikuman Perfect Origin Arc Season 2'),
    'City Hunter 2': (1471, 1988, 63, 'City Hunter 2'),
    'Occult Academy - S01': (6974, 2010, 13, 'Occult Academy'),
    'Berserk The Golden Age Arc ME': (155011, 2022, 13, 'Berserk: The Golden Age Arc - Memorial Edition'),
    'Fairy Tail S2': (20626, 2014, 102, 'Fairy Tail Season 2'),
    'Fairy Tail S3': (99749, 2018, 51, 'Fairy Tail Series 3'),
    'Ansatsu Kyoushitsu S2': (21170, 2016, 25, 'Ansatsu Kyoushitsu 2nd Season'),
    'Boku no Hero Academia 3rd Season': (100166, 2018, 25, 'My Hero Academia Season 3'),
    'Boku no Hero Academia 4rd Season': (104276, 2019, 25, 'My Hero Academia Season 4'),
    "JoJo's Bizare Adventure Part 5": (102883, 2018, 39, "JoJo's Bizarre Adventure Part 5"),
    "JoJo's Bizare Adventure Part 4": (21450, 2016, 39, "JoJo's Bizarre Adventure Part 4: Diamond is Unbreakable"),
    'Kuroko no basket season 3': (20725, 2015, 25, 'Kuroko no Basket 3rd SEASON'),
    'Kuroko no Basket S3': (20725, 2015, 25, 'Kuroko no Basket 3rd SEASON'),
    'Date A Live S2': (19163, 2014, 10, 'Date A Live 2'),
    'Date A Live S3': (100722, 2019, 12, 'Date a Live 3rd Season'),
    'Hamefura S02': (120209, 2021, 12, 'Hamefura 2'),
    'Owarimonogatari S2': (21745, 2017, 7, 'Owarimonogatari Second Season'),
    'Kobayashi-san Chi no Maid Dragon S2': (107717, 2021, 12, 'Kobayashi-san Chi no Maid Dragon 2nd Season'),
    'Enen no Shouboutai فصل2': (114236, 2020, 24, 'Enen no Shouboutai 2'),
    'Haikyuu!! فصل: 3': (21698, 2016, 10, 'HAIKYU!! 3rd Season'),
    'نام انیمه : Haikyuu فصل : 2': (20992, 2015, 25, 'Haikyuu!! 2nd Season'),
    'Full Dive': (126791, 2021, 12, 'Full Dive: This Ultimate Next-Gen Full Dive RPG Is Even Shittier than Real Life!'),
    'Osananajimi ga Zettai': (124675, 2021, 12, 'Osananajimi ga Zettai ni Makenai Love Kome'),
    'Boruto - Naruto Next Generation': (97938, 2017, 293, 'Boruto: Naruto Next Generations'),
    'Boruto': (97938, 2017, 293, 'Boruto: Naruto Next Generations'),
    'Food Wars! S2': (21518, 2016, 13, 'Food Wars! The Second Plate'),
    'Food Wars! S4': (109963, 2019, 12, 'Food Wars! The Fourth Plate'),
    # Provider graph reviewed: no TV prequel; direct sequel explicitly named
    # Season 2 (20626, 20958, 16894, 114236 respectively). Not a generic S1 rule.
    'Fairy Tail S1': (6702, 2009, 175, 'Fairy Tail'),
    'Fairy Tail - S1': (6702, 2009, 175, 'Fairy Tail'),
    'Shingeki no Kyojin S1': (16498, 2013, 25, 'Shingeki no Kyojin'),
    'Kuroko no Basket S1': (11771, 2012, 25, 'Kuroko no Basket'),
    'Enen no Shouboutai S01': (105310, 2019, 24, 'Enen no Shouboutai'),
    # Same direct Season-2 sequel / no-TV-prequel graph proof, reviewed after
    # fetching the base title rather than trusting an empty S1 search.
    'Kingdom S1': (12031, 2012, 38, 'Kingdom'),
    'Blue Exorcist S1': (9919, 2011, 25, 'Blue Exorcist'),
    'One Punch Man S1': (21087, 2015, 12, 'One-Punch Man'),
    'Black Lagoon - S01': (889, 2006, 12, 'Black Lagoon'),
    'Black Lagoon- S01': (889, 2006, 12, 'Black Lagoon'),
    # R1 verified through the 1575 -> 2904 TV sequel edge; R2 is explicitly
    # named "2nd Season" in that provider node. Compilation films are distinct.
    'Code Geass R1': (1575, 2006, 25, 'Code Geass: Lelouch of the Rebellion'),
    # The archive caption uses lowercase ll, but each accepted file must also
    # spell the official Roman-II title in its filename (guarded below).
    'Toaru Majutsu Index ll': (8937, 2010, 24, 'Toaru Majutsu no Index II'),
    'Future Diary (Mirai Nikki': (10620, 2011, 26, 'Mirai Nikki'),
    'Sword Art Online S2': (20594, 2014, 24, 'Sword Art Online II'),
    'Sword Art Online S3': (100182, 2018, 24, 'Sword Art Online III'),
    'Fruits Basket S2 (2019': (111762, 2020, 25, 'Fruits Basket (2019) 2'),
    # Reviewed complete base searches plus original-TV relation graphs. These
    # literal S1 labels identify the sole matching original TV, not a generic
    # rule stripping S1. Fruits Basket/remakes and Psycho-Pass/recuts stay held.
    'The Seven Deadly Sins(S1': (20789, 2014, 24, 'The Seven Deadly Sins'),
    'Sword Art Online - S01': (11757, 2012, 25, 'Sword Art Online'),
    'Full Metal Panic S1': (71, 2002, 24, 'Full Metal Panic!'),
    'Dr. Stone S1': (105333, 2019, 24, 'Dr. STONE'),
    'Kakegurui S1': (98314, 2017, 12, 'Kakegurui'),
    'Hell Girl S1': (228, 2005, 26, 'Hell Girl'),
    'Danmachi S01': (20920, 2015, 13, 'Danmachi'),
    'DanMachi S01': (20920, 2015, 13, 'Danmachi'),
    'Jashin-chan Dropkick -S1': (100714, 2018, 11, 'Jashin-chan Dropkick'),
    'No.6-s1': (10161, 2011, 11, 'No.6'),
    'No.6 S1': (10161, 2011, 11, 'No.6'),
    'Big Order - s1': (21445, 2016, 10, 'Big Order'),
    # Reviewed live provider entries/TV relation graph, 2026-10-28. Movie/OVA
    # entries remain separate; the two Toaru captions also require the exact
    # official title independently present in each filename (guarded below).
    'Bunny Girl Senpai': (101291, 2018, 13, 'Rascal Does Not Dream of Bunny Girl Senpai'),
    'Toaru Majutsu Index': (4654, 2008, 24, 'Toaru Majutsu no Index'),
    'Toaru Majutsu Railgun': (6213, 2009, 24, 'Toaru Kagaku no Railgun'),
    'Clannad - S02': (4181, 2008, 24, 'Clannad: After Story'),
    'Kakegurui S2': (100876, 2019, 12, 'Kakegurui xx'),
    'Shokugeki no Soma S5': (114043, 2020, 13, 'Food Wars! The Fifth Plate'),
    'Isekai Quartet Season 1': (104454, 2019, 12, 'Isekai Quartet'),
    'Isekai Quartet Season 2': (110178, 2020, 12, 'Isekai Quartet 2'),
    'Kamisama Hajimemashita S1': (14713, 2012, 13, 'Kamisama Hajimemashita'),
    '100-man no Inochi SE02': (127366, 2021, 12, "I'm Standing on a Million Lives Season 2"),
    'Berserk (2017': (97643, 2017, 12, 'Berserk 2'),
    # Literal abbreviated archive names reviewed against MAL 53263/49533 and
    # the official shippona-anime.com 13-episode announcement. No prefix rule.
    'Seija Musou': (155418, 2023, 12, 'Seija Musou: Salaryman, Isekai de Ikinokoru Tame ni Ayumu Michi'),
    'Uchi no Shishou wa Shippo': (137341, 2022, 13, 'Uchi no Shishou wa Shippo ga Nai'),
    # MAL 51863 explicitly pairs this English title with the Chinese identity;
    # AniList 149810 was independently fetched and cross-checked via idMal.
    'The Strongest Male Hero Ever': (149810, 2022, 48, 'Shishang Zui Qiang Nan Zhujue'),
    # Individually checked original series/sequel records and external episode
    # lists. These are literal, bounded archive cohorts, not an S1-strip rule.
    'Tennis no Ouji-sama S1': (22, 2001, 178, 'Tennis no Ouji-sama'),
    'Mushishi S1': (457, 2005, 26, 'Mushishi'),
    'Hajime no Ippo S1': (263, 2000, 75, 'Hajime no Ippo: THE FIGHTING!'),
    'Log Horizon S1': (17265, 2013, 25, 'Log Horizon'),
    'Log Horizon S2': (20671, 2014, 25, 'Log Horizon 2'),
    'Michiko and Hatchin': (4087, 2008, 22, 'Michiko & Hatchin'),
    'Ningen Fushin': (137909, 2023, 12, 'Ningen Fushin no Boukensha-tachi ga Sekai wo Sukuu you desu'),
    # Reviewed after complete base-name searches; external episode/season
    # evidence is recorded in docs/archive-reference-reviews.md. No generic S1.
    '2.5 Dimensional Seduction S01': (158559, 2024, 24, '2.5 Dimensional Seduction'),
    'Toujima Tanzaburou wa Kamen Rider ni Naritai - S1': (187464, 2025, 24, 'Toujima Tanzaburou wa Kamen Rider ni Naritai'),
    'Tensei shitara Slime Datta Ken 1nd Season': (101280, 2018, 24, 'Tensei Shitara Slime Datta Ken'),
    'Futari Solo Camp S1': (185965, 2025, 24, 'Futari Solo Camp'),
    'Black Bulter S1': (4898, 2008, 24, 'Black Butler'),
    'March comes in like a lion S1': (21366, 2016, 22, 'March comes in like a lion'),
    'Uchouten Kazoku S1': (17909, 2013, 13, 'Uchouten Kazoku'),
    'Kaginado S1': (132528, 2021, 12, 'KAGINADO'),
    'Gin no saji S1': (16918, 2013, 11, 'Gin no Saji'),
    'Ghost in the Shell-s1': (467, 2002, 26, 'Ghost in the Shell: Stand Alone Complex'),
    'Senki Zesshou Symphogear GX S3': (20560, 2015, 13, 'Senki Zesshou Symphogear GX'),
    'Amagami SS Season 1': (8676, 2010, 25, 'Amagami SS'),
    'Snow White with the Red Hair-s01': (21058, 2015, 12, 'Snow White with the Red Hair'),
    'Isekai wa Smartphone to Tomo ni S2': (147571, 2023, 12, 'Isekai wa Smartphone to Tomo ni. 2'),
    'TOHAI - Ura Rate Mahjong Touhai Roku': (173263, 2024, 25, 'Touhai: Ura Rate Mahjong Touhai Roku'),
    'Dragon Raja S2': (157692, 2025, 24, 'Long Zu 2'),
    'Kodocha.S1': (1486, 1996, 102, 'Kodocha'),
    'Amagami SS season2': (11235, 2012, 13, 'Amagami SS+ plus'),
    'Yowamushi Pedal S5': (142481, 2022, 25, 'Yowamushi Pedal: LIMIT BREAK'),
    'Hibike! Euphonium S3': (109731, 2024, 13, 'Hibike! Euphonium 3'),
    'Black Bulter S2': (6707, 2010, 12, 'Black Butler II'),
    'Four People and Their Respective Lies': (146962, 2022, 11, '4-nin wa Sorezore Uso wo Tsuku'),
    'Tearmoon Teikoku Monogatari': (154384, 2023, 12, 'Tearmoon Empire'),
    'Tong Ling Fei S2': (175645, 2025, 24, 'Tongling Fei 2'),
    'Dagashi Kashi S1': (21365, 2016, 12, 'Dagashi Kashi'),
    'Dagashi Kashi - S2': (99734, 2018, 12, 'Dagashi Kashi 2'),
    'Monster but Wild S2': (166510, 2023, 16, 'Monster But Wild 2'),
    'Wo De Tian Jie Nv You': (100296, 2017, 15, 'My Cultivator Girlfriend'),
    'Yi Nian Yong Heng 3rd Season': (168104, 2024, 59, 'Yi Nian Yongheng 3'),
    'Jormungand S2': (13331, 2012, 12, 'Jormungand: PERFECT ORDER'),
    'New game S1': (21455, 2016, 12, 'NEW GAME!'),
    'New game S2': (98292, 2017, 12, 'NEW GAME!!'),
    'Ookami to koushinryou S2': (5341, 2009, 12, 'Ookami to Koushinryou II'),
    'Goblin Slayer S2': (129188, 2023, 12, 'Goblin Slayer II'),
    'Shinka no Mi S2': (146954, 2023, 12, 'Shin Shinka no Mi: Shiranai Uchi ni Kachigumi Jinsei'),
    # Bounded cohorts personally reviewed 2026-11-04: explicit S2/S3 archive
    # captions, complete matching primary nodes and MAL cross-references.
    'The Seven Deadly Sins(S2': (99539, 2018, 24, 'The Seven Deadly Sins: Revival of the Commandments'),
    'The Seven Deadly Sins(S3': (108928, 2019, 24, 'The Seven Deadly Sins: Imperial Wrath of the Gods'),
    'Ghost in the Shell-s2': (801, 2004, 26, 'Ghost in the Shell: Stand Alone Complex 2nd GIG'),
    # Bare Kenshin is not remake evidence: the independent filename must carry
    # the explicit 2023 year, enforced separately below for every accepted file.
    'Rurouni Kenshin': (142877, 2023, 24, 'Rurouni Kenshin (2023)'),
    # Second bounded 2026-11-04 review: original filename titles and exact TV
    # references checked independently; specials/misnumbered files stay held.
    'magi the labyrinth of magic - S2': (18115, 2013, 25, 'Magi: The Kingdom of Magic'),
    'Story Of The Alps': (2546, 1983, 48, 'Story of the Alps: My Annette'),
    'Classroom S2': (145545, 2022, 13, 'Classroom of the Elite Season 2'),
    "The Ancient Magus'Bride": (98436, 2017, 24, "The Ancient Magus' Bride"),
    'Chuunibyou S1': (14741, 2012, 12, 'Love, Chunibyo & Other Delusions'),
    'Chuunibyou S2': (18671, 2014, 12, 'Love, Chunibyo & Other Delusions - Heart Throb -'),
    # Third 2026-11-04 cohort: complete primary season synonyms / independently
    # named sequel filenames; one quality-conflicting SNAFU S3 file stays held.
    'SNAFU S1': (14813, 2013, 13, 'My Teen Romantic Comedy SNAFU'),
    'SNAFU S2': (20698, 2015, 13, 'My Teen Romantic Comedy SNAFU TOO!'),
    'SNAFU S3': (108489, 2020, 12, 'My Teen Romantic Comedy SNAFU Climax!'),
    'Non Non Biyori Repeat S2': (20694, 2015, 12, 'Non Non Biyori Repeat'),
    'Log Horizon: Destruction of the Round Table S3': (114862, 2021, 12, 'Log Horizon: Destruction of the Round Table'),
    'Kekkai sensen - S2': (97886, 2017, 12, 'Blood Blockade Battlefront & Beyond'),
    # User-reported filename-only cohorts: individually inspected Matroska
    # headers, primary ID/MAL nodes and explicit Lost Girls numbering evidence.
    'Kiznaiver': (21421, 2016, 12, 'Kiznaiver'),
    'Owari no Seraph': (20829, 2015, 12, 'Owari no Seraph'),
    'Owari no Seraph - Nagoya Kessen Hen S2': (20993, 2015, 12, 'Owari no Seraph: Nagoya Kessen-hen'),
    'UQ Holder': (21855, 2017, 12, 'UQ Holder!'),
    'Yahari Ore no Seishun Love Comedy wa Machigatteiru Zoku': (20698, 2015, 13, 'My Teen Romantic Comedy SNAFU TOO!'),
    'Shingeki no Kyojin: LOST GIRLS': (99634, 2017, 3, 'Shingeki no Kyojin: LOST GIRLS'),
    # Bounded bulk review: literal archive abbreviations, independently checked
    # against complete primary nodes and their cross-provider IDs. Filename
    # identities and positive codec evidence are additionally checked below.
    'THE Great Mission': (159560, 2023, 97, 'Tousouchuu: The Great Mission'),
    'Botsuraku Yotei': (176063, 2025, 12, 'Botsuraku Yotei no Kizoku dakedo, Hima Datta kara Mahou wo Kiwamete mita'),
    'The ice guy and his cool female': (151252, 2023, 12, 'The Ice Guy and His Cool Female Colleague'),
    'Jijou wo Shiranai': (157295, 2023, 13, 'Jijou wo Shiranai Tenkousei ga Guigui Kuru.'),
    'Ouji no Akaji Kokka Saisei': (129190, 2022, 12, 'Tensai Ouji no Akaji Kokka Saisei Jutsu'),
    'Guimi Zhi Zhu': (137667, 2025, 13, 'Lord of Mysteries'),
    'Grendizer U Season I': (154195, 2024, 13, 'Grendizer U'),
}

APPROVED_ALIAS_FORMATS = {
    'JoJo no Kimyou na Bouken: Stone Ocean Part 2': 'ONA',
    'Baccano! Bangai-hen': 'SPECIAL',
    'Guimi Zhi Zhu': 'ONA',
    'Shingeki no Kyojin: LOST GIRLS': 'OVA',
    'Isekai Quartet Season 1': 'TV_SHORT',
    'Isekai Quartet Season 2': 'TV_SHORT',
    'Seija Musou': 'ONA',
    'The Strongest Male Hero Ever': 'ONA',
    'Ningen Fushin': 'ONA',
    'Kaginado S1': 'TV_SHORT',
    'Dragon Raja S2': 'ONA',
    'Tong Ling Fei S2': 'ONA',
    'Dagashi Kashi - S2': 'TV_SHORT',
    'Monster but Wild S2': 'ONA',
    'Wo De Tian Jie Nv You': 'ONA',
    'Yi Nian Yong Heng 3rd Season': 'ONA',
}
APPROVED_ALIAS_MAX_RECORD_ID = {
    'Shingeki no Kyojin Season 3': 3278,
    'Shingeki no Kyojin Season 3 Part 2': 3278,
    'Bungo Stray Dogs': 10390,
    'Bungou Stray Dogs 2nd Season': 10390,
    'Bungou Stray Dogs 3rd Season': 10390,
    '86: Eighty Six': 13988,
    '86: Eighty Six Part 2': 13988,
    'Shokugeki no Souma: San no Sara': 8720,
    'Shokugeki no Souma: San no Sara - Tootsuki Ressha-hen': 8720,
    'Mushoku Tensei: Isekai Ittara Honki Dasu': 14221,
    'Mushoku Tensei: Isekai Ittara Honki Dasu Part 2': 14221,
    'The Case Study of Vanitas': 21766,
    'Vanitas no Carte Part 2': 21766,
    'JoJo no Kimyou na Bouken: Stone Ocean Part 2': 36876,
    'Free Eternal Summer S2': 16604,
    'Steins Gate 0': 3495,
    'Night Head 2041': 7998,
    'Night Head 2041 .': 9500,
    'Night Head2041': 14773,
    'Tokyo Magnitude 8.0': 69085,
    'Baccano! Bangai-hen': 68069,
    'Snowball Earth Ep:': 110815,
    'Mairimashita iruma-kon S3': 41326,
    'MEGUMI NO DAIGO': 76438,
    'Muscleman S2': 81071,
    'City Hunter 2': 85584,
    'Occult Academy - S01': 46280,
    'Berserk The Golden Age Arc ME': 37368,
    'THE Great Mission': 75652,
    'Botsuraku Yotei': 73767,
    'The ice guy and his cool female': 72634,
    'Jijou wo Shiranai': 73334,
    'Ouji no Akaji Kokka Saisei': 71767,
    'Guimi Zhi Zhu': 95927,
    'Grendizer U Season I': 63546,
    'Kiznaiver': 1572,
    'Owari no Seraph': 3572,
    'Owari no Seraph - Nagoya Kessen Hen S2': 3585,
    'UQ Holder': 4006,
    'Yahari Ore no Seishun Love Comedy wa Machigatteiru Zoku': 7876,
    'Shingeki no Kyojin: LOST GIRLS': 2212,
    # Current reviewed archive cohorts only; a future file reusing a shortened
    # label must not silently inherit this review after a sequel/remake appears.
    'Seija Musou': 75131,
    'Uchi no Shishou wa Shippo': 71847,
    'The Strongest Male Hero Ever': 32432,
    'Tennis no Ouji-sama S1': 45422,
    'Mushishi S1': 66699,
    'Hajime no Ippo S1': 102980,
    'Log Horizon S1': 43441,
    'Log Horizon S2': 68839,
    'Michiko and Hatchin': 45521,
    'Ningen Fushin': 72764,
    '2.5 Dimensional Seduction S01': 77583,
    'Toujima Tanzaburou wa Kamen Rider ni Naritai - S1': 107320,
    'Tensei shitara Slime Datta Ken 1nd Season': 872,
    'Futari Solo Camp S1': 103256,
    'Black Bulter S1': 35089,
    'March comes in like a lion S1': 67927,
    'Uchouten Kazoku S1': 83494,
    'Kaginado S1': 22492,
    'Gin no saji S1': 40651,
    'Ghost in the Shell-s1': 42937,
    'Senki Zesshou Symphogear GX S3': 38023,
    'Amagami SS Season 1': 40260,
    'Snow White with the Red Hair-s01': 79270,
    'Isekai wa Smartphone to Tomo ni S2': 47158,
    'TOHAI - Ura Rate Mahjong Touhai Roku': 80851,
    'Dragon Raja S2': 103248,
    'Kodocha.S1': 114498,
    'Amagami SS season2': 40310,
    'Yowamushi Pedal S5': 42510,
    'Hibike! Euphonium S3': 59645,
    'Black Bulter S2': 34482,
    'Four People and Their Respective Lies': 72032,
    'Tearmoon Teikoku Monogatari': 55391,
    'Tong Ling Fei S2': 115543,
    'Dagashi Kashi S1': 47409,
    'Dagashi Kashi - S2': 47449,
    'Monster but Wild S2': 68278,
    'Wo De Tian Jie Nv You': 14571,
    'Yi Nian Yong Heng 3rd Season': 114198,
    'Jormungand S2': 77883,
    'New game S1': 41112,
    'New game S2': 41152,
    'Ookami to koushinryou S2': 48500,
    'Goblin Slayer S2': 55330,
    'Shinka no Mi S2': 42617,
    'The Seven Deadly Sins(S2': 10954,
    'The Seven Deadly Sins(S3': 11029,
    'Ghost in the Shell-s2': 43720,
    'Rurouni Kenshin': 55046,
    'magi the labyrinth of magic - S2': 50117,
    'Story Of The Alps': 104077,
    'Classroom S2': 32088,
    "The Ancient Magus'Bride": 34842,
    'Chuunibyou S1': 30334,
    'Chuunibyou S2': 30404,
    'SNAFU S1': 44735,
    'SNAFU S2': 44781,
    'SNAFU S3': 44822,
    'Non Non Biyori Repeat S2': 42136,
    'Log Horizon: Destruction of the Round Table S3': 68881,
    'Kekkai sensen - S2': 32395,
}
APPROVED_ALIAS_MAL_IDS = {
    'Shingeki no Kyojin Season 3': 35760,
    'Shingeki no Kyojin Season 3 Part 2': 38524,
    'Bungo Stray Dogs': 31478,
    'Bungou Stray Dogs 2nd Season': 32867,
    'Bungou Stray Dogs 3rd Season': 38003,
    '86: Eighty Six': 41457,
    '86: Eighty Six Part 2': 48569,
    'Shokugeki no Souma: San no Sara': 35788,
    'Shokugeki no Souma: San no Sara - Tootsuki Ressha-hen': 36949,
    'Mushoku Tensei: Isekai Ittara Honki Dasu': 39535,
    'Mushoku Tensei: Isekai Ittara Honki Dasu Part 2': 45576,
    'The Case Study of Vanitas': 48580,
    'Vanitas no Carte Part 2': 49114,
    'JoJo no Kimyou na Bouken: Stone Ocean Part 2': 51367,
    'Free Eternal Summer S2': 22265,
    'Steins Gate 0': 30484,
    'Night Head 2041': 43767,
    'Night Head 2041 .': 43767,
    'Night Head2041': 43767,
    'Tokyo Magnitude 8.0': 6211,
    'Baccano! Bangai-hen': 3901,
    'Snowball Earth Ep:': 62068,
    'Mairimashita iruma-kon S3': 49784,
    'MEGUMI NO DAIGO': 53848,
    'Muscleman S2': 59914,
    'City Hunter 2': 1471,
    'Occult Academy - S01': 6974,
    'Berserk The Golden Age Arc ME': 52976,
    'THE Great Mission': 54040,
    'Botsuraku Yotei': 58437,
    'The ice guy and his cool female': 52173,
    'Jijou wo Shiranai': 53621,
    'Ouji no Akaji Kokka Saisei': 47159,
    'Guimi Zhi Zhu': 49818,
    'Grendizer U Season I': 56189,
    'Kiznaiver': 31798,
    'Owari no Seraph': 26243,
    'Owari no Seraph - Nagoya Kessen Hen S2': 28927,
    'UQ Holder': 33478,
    'Yahari Ore no Seishun Love Comedy wa Machigatteiru Zoku': 23847,
    'Shingeki no Kyojin: LOST GIRLS': 36106,
    'The Strongest Male Hero Ever': 51863,
    'Tennis no Ouji-sama S1': 22,
    'Mushishi S1': 457,
    'Hajime no Ippo S1': 263,
    'Log Horizon S1': 17265,
    'Log Horizon S2': 23321,
    'Michiko and Hatchin': 4087,
    'Ningen Fushin': 49612,
    '2.5 Dimensional Seduction S01': 53802,
    'Toujima Tanzaburou wa Kamen Rider ni Naritai - S1': 61159,
    'Tensei shitara Slime Datta Ken 1nd Season': 37430,
    'Futari Solo Camp S1': 60665,
    'Black Bulter S1': 4898,
    'March comes in like a lion S1': 31646,
    'Uchouten Kazoku S1': 17909,
    'Kaginado S1': 48775,
    'Gin no saji S1': 16918,
    'Ghost in the Shell-s1': 467,
    'Senki Zesshou Symphogear GX S3': 21573,
    'Amagami SS Season 1': 8676,
    'Snow White with the Red Hair-s01': 30123,
    'Isekai wa Smartphone to Tomo ni S2': 51632,
    'TOHAI - Ura Rate Mahjong Touhai Roku': 57796,
    'Dragon Raja S2': 59662,
    'Kodocha.S1': 1486,
    'Amagami SS season2': 11235,
    'Yowamushi Pedal S5': 50552,
    'Hibike! Euphonium S3': 39894,
    'Black Bulter S2': 6707,
    'Four People and Their Respective Lies': 51464,
    'Tearmoon Teikoku Monogatari': 52962,
    'Tong Ling Fei S2': 60577,
    'Dagashi Kashi S1': 31636,
    'Dagashi Kashi - S2': 36049,
    'Monster but Wild S2': 55762,
    'Wo De Tian Jie Nv You': 36455,
    'Yi Nian Yong Heng 3rd Season': 56215,
    'Jormungand S2': 13331,
    'New game S1': 31953,
    'New game S2': 34914,
    'Ookami to koushinryou S2': 5341,
    'Goblin Slayer S2': 47160,
    'Shinka no Mi S2': 51495,
    'The Seven Deadly Sins(S2': 34577,
    'The Seven Deadly Sins(S3': 39701,
    'Ghost in the Shell-s2': 801,
    'Rurouni Kenshin': 50613,
    'magi the labyrinth of magic - S2': 18115,
    'Story Of The Alps': 2546,
    'Classroom S2': 51096,
    "The Ancient Magus'Bride": 35062,
    'Chuunibyou S1': 14741,
    'Chuunibyou S2': 18671,
    'SNAFU S1': 14813,
    'SNAFU S2': 23847,
    'SNAFU S3': 39547,
    'Non Non Biyori Repeat S2': 23623,
    'Log Horizon: Destruction of the Round Table S3': 41109,
    'Kekkai sensen - S2': 34451,
}
APPROVED_FILENAME_TITLES = {
    'Toaru Majutsu Index ll': 'Toaru Majutsu no Index II',
    'Toaru Majutsu Index': 'Toaru Majutsu no Index',
    'Toaru Majutsu Railgun': 'Toaru Kagaku no Railgun',
    '100-man no Inochi SE02': '100-man no Inochi SE02',
    'Black Bulter S1': 'Black Butler S1',
    'Black Bulter S2': 'Black Butler S2',
    'Ghost in the Shell-s1': 'Ghost in the Shell (S.A.C) S01',
}
APPROVED_FILENAME_YEARS = {'Berserk (2017': 2017, 'Rurouni Kenshin': 2023}
APPROVED_NUMERIC_CAPTION_PREFIXES = {'Hibike! Euphonium S3': 'Hibike! Euphonium 3',
                                    'Steins Gate 0': 'Steins Gate 0',
                                    'City Hunter 2': 'City Hunter 2',
                                    'Night Head 2041': 'Night Head 2041',
                                    'Night Head 2041 .': 'Night Head 2041',
                                    'Night Head2041': 'Night Head 2041',
                                    'Tokyo Magnitude 8.0': 'Tokyo Magnitude 8.0'}
# This reviewed label has one fully certified provider page and a legacy
# duplicate. Reuse the certified page without deleting, merging or hiding either.
APPROVED_ALIAS_TARGET_KEYS = {'Berserk The Golden Age Arc ME': 'al155011',
                              'Dr. Stone S1': 't24816699656'}
APPROVED_LEGACY_DUPLICATE_FACTS = {
    'Dr. Stone S1': ('hdr-stone-t124700703339', {
        'titleEn': 'Dr. Stone', 'titleOriginal': 'Dr. Stone', 'year': 2020,
        'format': 'TV', 'type': 'سریال', 'metadataProviderId': None, 'declaredEpisodes': None,
        'slug': 'dr-stone', 'firstPostId': 826, 'lastPostId': 826, 'postIds': [826]}),
}
NUMBERING_VARIANTS = {
    # Provider total, competing compact numbering. Bounds alone cannot tell an
    # incomplete broadcast set from recuts, shorts compiled into long episodes,
    # or a release that removed/renumbered recaps. See the reference review doc.
    13601: (22, 11),   # PSYCHO-PASS original vs New Edit Version
    21804: (120, 24),  # Saiki K. shorts vs weekly compilations
    17074: (26, 23),   # Monogatari Second Season with/without three recaps
}

# Not a general prefix/fuzzy matcher: only these independently reviewed source
# cohorts may use the exact alternate titles and the observed AniPlus template.
BULK_ALIAS_FILENAME_TITLES = {
    'Snowball Earth Ep:': ('Snowball Earth',),
    'Mairimashita iruma-kon S3': ('Mairimashita! Iruma-kun S3', 'Mairimashita iruma-kon S3', 'Mairimashita iruma-kon'),
    'MEGUMI NO DAIGO': ('Megumi no Daigo - Kyuukoku no Orange',),
    'Muscleman S2': ('Kinnikuman Perfect Origin-hen S2',),
    'Berserk The Golden Age Arc ME': ('Berserk The Golden Age Arc ME',),
    'THE Great Mission': ('THE GREAT MISSION', 'Tousouchuu: The Great Mission'),
    'Botsuraku Yotei': ('Botsuraku Yotei', 'Botsuraku Yotei no Kizoku dakedo, Hima Datta kara Mahou wo Kiwamete mita'),
    'The ice guy and his cool female': ('The ice guy and his cool female', 'Koori Zokusei Danshi to Cool na Douryou Joshi'),
    'Jijou wo Shiranai': ('Jijou wo Shiranai', 'Jijou wo Shiranai Tenkousei ga Guigui Kuru.'),
    'Ouji no Akaji Kokka Saisei': ('Ouji no Akaji Kokka Saisei', 'Tensai Ouji no Akaji Kokka Saisei Jutsu'),
    'Guimi Zhi Zhu': ('Guimi Zhi Zhu', 'Guimi Zhi Zhu: Xiaochou Pian'),
    'Grendizer U Season I': ('Grendizer U',),
}


def bulk_alias_filename_allowed(record):
    from backfill import parse_archive_fields
    from resolver import _quality_of
    expected = BULK_ALIAS_FILENAME_TITLES.get(record.get('title'))
    if expected is None:
        return True
    ident = record.get('id')
    if type(ident) is not int or not 0 < ident <= APPROVED_ALIAS_MAX_RECORD_ID[record['title']]:
        return False
    name = record.get('name') or ''
    wanted = _quality_of(record.get('quality') or '')
    actual = _quality_of(name)
    if (actual[0] and actual[0] != wanted[0]) or actual[1] and not wanted[1]:
        return False
    stated = {int(value) for value in re.findall(r'(?<![A-Za-z0-9])(\d{2,4})p\b', name.replace('_', ' '), re.I)}
    declared = re.match(r'(\d{2,4})p\b', str(record.get('quality') or ''), re.I)
    if stated and (not declared or stated != {int(declared[1])}):
        return False
    if re.search(r'\bx\s*264\b', name.replace('_', ' '), re.I) and wanted[1]:
        return False
    allowed = {normalized(title) for title in expected}
    filename = parse_archive_fields(name, '', ident, allow_incomplete=True)
    if filename and normalized(filename['title']) in allowed:
        return True
    # The episode is removed only from this observed complete source template,
    # never from an arbitrary numeric title or a sequel suffix.
    match = re.fullmatch(r'@AniPlus_(.+)_(\d{1,4})_((?:2160|1440|1080|720|576|480)p)(?:_[^.]*)?\.(?:mkv|mp4)', name, re.I)
    if not match and record['title'] == 'The ice guy and his cool female':
        match = re.fullmatch(r'AnimeON(.+)-(\d{1,4})-(\d{3,4}p)-\.(?:mkv|mp4)', name, re.I)
    return bool(match and normalized(match[1]) in allowed and int(match[2]) == record.get('episode')
                and match[3].lower() == wanted[0])


def normalized(value):
    return ''.join(c for c in unicodedata.normalize('NFKC', str(value or '')).casefold().replace('×','x') if c.isalnum())


def canonical_query(value):
    """Remove archive-only labels and standardize explicit seasons, never infer one."""
    text = unicodedata.normalize('NFKC', str(value or '')).strip()
    text = re.sub(r'^نام\s*انیمه\s*[:：]\s*', '', text, flags=re.I)
    uploaders = r'(?:AnimeWorldqw|AnimeWorldDL|AnimWorldDL|AniPlus)'
    text = re.sub(r'^@' + uploaders + r'[.)\]\s]+', '', text, flags=re.I)
    text = re.sub(r'^\[(?:@' + uploaders + r'|AWHT|MrAnime\.pw)\]\s*', '', text, flags=re.I)
    text = re.sub(r'(?:\s*[-–—]+\s*Quality|\s+Quality\s+Format(?:\s+mkv)?)\s*$', '', text, flags=re.I)
    text = re.sub(r'(?:\.(?:mkv|mp4)|\s+mkv)\s*$', '', text, flags=re.I)
    ordinal_words = {'first': 1, 'second': 2, 'third': 3, 'fourth': 4, 'fifth': 5}
    text = re.sub(r'\b(first|second|third|fourth|fifth)\s+season\b',
                  lambda match: 'Season ' + str(ordinal_words[match[1].casefold()]), text, flags=re.I)
    season_patterns = (
        r'\bS\s*0*(\d{1,2})\b', r'\b(\d{1,2})(?:st|nd|rd|th)\s+season\b',
        r'فصل\s*:?\s*(\d{1,2})\b', r'\b(?:season|series)\s*0*(\d{1,2})\b',
    )
    for pattern in season_patterns:
        text = re.sub(pattern, lambda match: ' Season ' + str(int(match[1])), text, flags=re.I)
    return re.sub(r'\s+', ' ', text).strip(' -–—_:')


def identity_names(media):
    values = [value for value in [*(media.get('title') or {}).values(),
              *(media.get('synonyms') or [])] if value]
    result = {normalized(canonical_query(value)) for value in values}
    seasons = {number for value in values for kind, number in explicit_markers(canonical_query(value))
               if kind == 'season'}
    official_parts = {number for value in (media.get('title') or {}).values() if value
                      for kind, number in explicit_markers(value) if kind == 'part'}
    # A provider may explicitly call one language "Season 2" and another
    # "Enen no Shouboutai 2". Both fields belong to the SAME provider ID.
    # Never infer a season from a trailing number without that explicit field.
    if len(seasons) == 1 and not official_parts:
        season = next(iter(seasons))
        for value in values:
            match = re.fullmatch(r'(.+\S)\s+0*(\d{1,2})', value.strip())
            if match and int(match[2]) == season and not explicit_markers(value):
                result.add(normalized(canonical_query(match[1]) + ' Season ' + str(season)))
    return result


def entry_media(entry):
    values = (entry.get('media', []) if entry.get('complete') else []) + (
        entry.get('canonicalMedia', []) if entry.get('canonicalComplete') else []) + (
        entry.get('reviewedGraphMedia', []) if entry.get('reviewedGraphComplete') else []) + (
        entry.get('baseMedia', []) if entry.get('baseComplete') else []) + (
        entry.get('reviewedWebMedia', []) if entry.get('reviewedWebComplete') else [])
    return list({media['id']: media for media in values}.values())


def reference_lookup(cache):
    """Index complete primary responses, never partial searches or fuzzy names."""
    pool = {media['id']: media for entry in cache.values() for media in entry_media(entry)}
    exact, versions = defaultdict(set), defaultdict(set)
    for ident, media in pool.items():
        for name in identity_names(media):
            exact[name].add(ident)
        # These broader keys add competing versions to the guard's candidate
        # set. They are never accepted as title equivalence by choose_identity.
        for name in adaptation_names(media):
            versions[name].add(ident)
    return pool, exact, versions


def reference_candidates(title, entry, lookup):
    pool, exact, versions = lookup
    name = normalized(canonical_query(title))
    ids = ({media['id'] for media in entry_media(entry)} | exact.get(name, set())
           | versions.get(name, set()) | versions.get(normalized(title), set()))
    return [pool[ident] for ident in sorted(ids) if ident in pool]


def enrich_reviewed_pages(state, cache, *, only_keys=None):
    """Correct a reviewed scraper year, preserving the page's source/posts.

    hboruto's exact full title was stored with 2023, while the
    official TV identity starts in 2017. This is a literal guarded correction,
    not permission to overwrite other conflicting pages or infer remake years.
    """
    enriched = 0
    key = 't24816699656'
    anime = state.get('anime', {}).get(key)
    if anime and (only_keys is None or key in only_keys):
        media = reference_lookup(cache)[0].get(105333)
        if (media and media.get('idMal') == 38691 and media.get('format') == 'TV'
                and media.get('status') == 'FINISHED' and media.get('episodes') == 24
                and (media.get('startDate') or {}).get('year') == 2019
                and all(normalized(anime.get(field)) == normalized('Dr. Stone') for field in ('titleEn', 'titleOriginal'))
                and anime.get('year') == 2019 and anime.get('format') in (None, 'TV')
                and anime.get('type') == 'سریال' and anime.get('declaredEpisodes') == 24
                and anime.get('metadataProviderId') in (None, 105333)
                and anime.get('slug') == 'dr-stone-2' and anime.get('postIds') == [29628]):
            updates = {'format': 'TV', 'metadataProviderId': 105333,
                       'metadataEnrichmentSource': 'anilist', 'metadataEnrichmentUrl': 'https://anilist.co/anime/105333'}
            enriched += int(any(anime.get(field) != value for field, value in updates.items()))
            anime.update(updates)
    key = 'hyozakura-san-chi-no-daisakusen'
    anime = state.get('anime', {}).get(key)
    if anime and (only_keys is None or key in only_keys):
        media = reference_lookup(cache)[0].get(158898)
        if (media and media.get('idMal') == 53865 and media.get('format') == 'TV'
                and media.get('status') == 'FINISHED' and media.get('episodes') == 27
                and (media.get('startDate') or {}).get('year') == 2024
                and normalized(anime.get('titleEn')) == normalized('Mission: Yozakura Family')
                and normalized(anime.get('titleOriginal')) == normalized('Yozakura-san Chi no Daisakusen')
                and anime.get('year') in (2023, 2024) and anime.get('format') in (None, 'TV')
                and anime.get('type') == 'سریال' and anime.get('metadataProviderId') in (None, 158898)
                and anime.get('declaredEpisodes') in (None, 27)):
            updates = {'year': 2024, 'format': 'TV', 'declaredEpisodes': 27, 'metadataProviderId': 158898,
                       'metadataEnrichmentSource': 'anilist', 'metadataEnrichmentUrl': 'https://anilist.co/anime/158898'}
            enriched += int(any(anime.get(field) != value for field, value in updates.items()))
            anime.update(updates)
    if only_keys is not None and 'hboruto' not in only_keys:
        return enriched
    anime = state.get('anime', {}).get('hboruto')
    if not anime or anime.get('year') not in {2017, 2023} or anime.get('format') != 'TV':
        return enriched
    if anime.get('metadataProviderId') not in (None, 97938) or anime.get('declaredEpisodes') not in (None, 293):
        return enriched
    expected = normalized('Boruto: Naruto Next Generations')
    if normalized(anime.get('titleEn')) != expected or normalized(anime.get('titleOriginal')) != expected:
        return enriched
    pool = {media['id']: media for entry in cache.values() for media in entry_media(entry)}
    media = pool.get(97938)
    if not media or media.get('format') != 'TV' or media.get('status') != 'FINISHED' or media.get('episodes') != 293:
        return enriched
    if (media.get('startDate') or {}).get('year') != 2017 or expected not in names(media):
        return enriched
    updates = {'year': 2017, 'declaredEpisodes': 293, 'metadataProviderId': 97938,
               'metadataEnrichmentSource': 'anilist', 'metadataEnrichmentUrl': 'https://anilist.co/anime/97938'}
    changed = any(anime.get(key) != value for key, value in updates.items())
    anime.update(updates)
    return int(changed) + enriched


def explicit_markers(text):
    """Compare explicit season/part labels across equivalent archive notation."""
    patterns = (
        ('season', r'\bs\s*(\d{1,2})(?=\b|e\d)'),
        ('season', r'\bseason\s*(\d{1,2})\b'),
        ('season', r'\b(\d{1,2})(?:st|nd|rd|th)\s+season\b'),
        ('season', r'فصل\s*:?\s*(\d{1,2})\b'),
        ('part', r'\bpart\s*(\d{1,2})\b'),
        ('part', r'بخش\s*:?\s*(\d{1,2})\b'),
    )
    value = str(text).replace('_', ' ')
    markers = {(kind, int(match[1])) for kind, pattern in patterns
               for match in re.finditer(pattern, value, re.I)
               if not (match[0].casefold().startswith('season')
                       and season_label_has_ordinal_prefix(value, match.start()))}
    words = {'first': 1, 'second': 2, 'third': 3, 'fourth': 4, 'fifth': 5,
             'sixth': 6, 'seventh': 7, 'eighth': 8, 'ninth': 9, 'tenth': 10}
    markers.update(('season', words[match[1].casefold()]) for match in re.finditer(
        r'\b(' + '|'.join(words) + r')\s+season\b', value, re.I))
    return markers


def safe_episode_record(record):
    from backfill import trailing_archive_episode
    number = record.get('episode')
    if isinstance(number, bool) or not isinstance(number, int) or number < 1 or 1900 <= number <= 2100:
        return False
    if Path(record.get('name') or '').suffix.lower() not in VIDEO_EXTENSIONS or not record.get('quality'):
        return False
    from archive_numbering_certificates import STONE_OCEAN_TITLE, certified_stone_ocean_source
    if record.get('title') == STONE_OCEAN_TITLE:
        source = certified_stone_ocean_source(record)
        # Validate the unchanged original labels with ALL normal guards before
        # accepting the separately certified canonical provider numbering.
        return bool(source and safe_episode_record(source))
    from archive_numbering_certificates import SPLIT_TITLES, certified_split_cour_source
    if record.get('title') in SPLIT_TITLES:
        source = certified_split_cour_source(record)
        return bool(source and safe_episode_record(source))
    name, caption, title = (str(record.get(key) or '') for key in ('name','caption','title'))
    fractional = r'(?:\b(?:S\d+[._\s-]*)?(?:Ep?|Episode)\s*|[-_–—]\s*)\d{1,4}[.,]\d{1,2}(?=[\s_\[().-]|$)'
    if re.search(fractional, name+' '+caption, re.I):
        return False
    # "Part 5 - 01" names a part followed by one episode, not episodes 5–1.
    pack_name=re.sub(r'\b(?:part|season|series)\s*\d{1,2}\b','',name,flags=re.I)
    pack_caption=re.sub(r'\b(?:part|season|series)\s*\d{1,2}\b','',caption,flags=re.I)
    prefix = APPROVED_NUMERIC_CAPTION_PREFIXES.get(title)
    ceiling = APPROVED_ALIAS_MAX_RECORD_ID.get(title)
    ident = record.get('id')
    if prefix and isinstance(ident, int) and not isinstance(ident, bool) and 0 < ident <= ceiling:
        from backfill import ARCHIVE_PREFIX_RE, parse_archive_fields
        filename = parse_archive_fields(name, '', ident)
        if title == 'Steins Gate 0':
            from archive_literal_files import reviewed_tv_filename
            filename = reviewed_tv_filename(record)
        if (filename and normalized(filename['title']) == normalized(title)
                and filename.get('episode') == number):
            # The independently reviewed official title ends in "3". It is
            # not episode 3 of a "3 - 01" pack. Only this exact title prefix is
            # excluded from range detection; all actual episode/quality guards
            # below still inspect the untouched caption and filename.
            bare_caption = ARCHIVE_PREFIX_RE.sub('', caption)
            pack_caption = re.sub(r'^\s*' + re.escape(prefix) + r'(?=\s*[-–—])', '', bare_caption, flags=re.I)
            bare_name = ARCHIVE_PREFIX_RE.sub('', name)
            pack_name = re.sub(r'^\s*' + re.escape(prefix) + r'(?=\s*[-–—])', '', bare_name, flags=re.I)
    if record.get('multiEpisode') or PACK.search(pack_name) or PACK.search(pack_caption) or SCENE_PACK.search(name) or SCENE_PACK.search(caption):
        return False
    # Do not let a caption erase an explicit filename season or part marker.
    if explicit_markers(name+' '+caption) - explicit_markers(title):
        return False
    if conflicts(record_markers(record)):
        return False
    # Captions are not allowed to silently relabel a filename's explicit E or
    # dash-before-quality episode number.
    episode_patterns = (
        r'\[S\d{1,2}[-_]0*(\d{1,4})\]',
        r'[-–—]\s*0*(\d{1,4})\s*-\s*(?=\[(?:2160|1440|1080|720|576|480)p?\])',
        r'\bS\d+[._\s-]*E\s*0*(\d{1,4})\b',
        r'\bS\d{1,2}\.(\d{1,4})(?=\.(?:2160|1440|1080|720|576|480)p\b)',
        r'\b(?:Ep?|Episode)\s*0*(\d{1,4})\b',
        r'[-–—]\s*0*(\d{1,4})\s*(?=\[|\(|\{|(?:2160|1440|1080|720|576|480)p?\b)',
    )
    explicit_episodes = {int(match[1]) for text in (name, caption) for pattern in episode_patterns
                          for match in re.finditer(pattern, text, re.I)}
    explicit_episodes.update(value for text in (name, caption)
                              if (value := trailing_archive_episode(text)) is not None)
    # Some releases lead with S01_02 before the title instead of S01E02.
    # It is still explicit file-level evidence, never permission for a caption
    # to relabel episode 02 as episode 01.
    for text in (name, caption):
        leading = re.match(r'^(?:\[[^\]]+\][_\s]*)?S\d{1,2}[_ .-]+0*(\d{1,4})(?=[_ .-]+\S)', text, re.I)
        if leading:
            explicit_episodes.add(int(leading[1]))
    if explicit_episodes and explicit_episodes != {number}:
        return False
    quality_pattern = r'(?<!\w)(2160|1440|1080|720|576|480)(?:p\b|(?=[\]\s)}._-]))'
    name_qualities = set(re.findall(quality_pattern, name.replace('_', ' '), re.I))
    caption_qualities = set(re.findall(quality_pattern, caption.replace('_', ' '), re.I))
    quality = re.match(r'(\d{3,4})p', str(record['quality']), re.I)
    if not quality or (name_qualities and name_qualities != {quality[1]}):
        return False
    if name_qualities and caption_qualities and name_qualities != caption_qualities:
        return False
    return True


def names(media):
    return {normalized(v) for v in [*(media.get('title') or {}).values(), *(media.get('synonyms') or [])] if v}


def safe_movie_record(record):
    """Validate one complete movie, not an inferred numbered TV episode.

    The catalog already represents a non-episodic movie in its single download
    slot. Keep the source episode null; publish_record owns that UI convention.
    """
    from backfill import parse_archive_fields
    if record.get('episode') not in (None, 1) or isinstance(record.get('episode'), bool):
        return False
    if re.search(r'\b(?:cd|disc|disk)\s*\d+\b', str(record.get('name') or ''), re.I):
        return False
    if re.search(r'\bS\d+[._\s-]*E\d+\b|\b(?:Ep?|Episode)\s*\d+\b|قسمت\s*:?\s*\d+',
                 str(record.get('name') or '') + ' ' + str(record.get('caption') or ''), re.I):
        return False
    validation = {**record, 'episode': 1}
    for field in ('name', 'caption'):
        # A labeled film index is part of its identity, not an episode claim.
        validation[field] = re.sub(r'\b(movie)\s*[-:]?\s*\d+\b', r'\1',
                                   str(record.get(field) or ''), flags=re.I)
    if not safe_episode_record(validation):
        return False
    filename = parse_archive_fields(record.get('name') or '', '', record['id'], record.get('size'), record.get('date', ''))
    return bool(filename and normalized(canonical_query(filename['title'])) == normalized(canonical_query(record.get('title'))))


def safe_special_record(record, total, provider=None):
    """A standalone special identity, never an extra slot on its TV parent.

    A missing number is only valid for a provider-confirmed single special.
    The filename must independently agree with the archive title. Without an
    explicit OVA/special label, both a finished exact standalone provider identity
    and its explicit filename year are mandatory. Short bare names may otherwise
    overlap TV adaptations whose provider titles contain a (TV) suffix.
    """
    from backfill import parse_archive_fields
    from archive_literal_files import certified_lost_girls, certified_baccano_special
    if certified_lost_girls(record, total, provider or {}) or certified_baccano_special(record, total, provider or {}):
        return True
    if isinstance(total, bool) or not isinstance(total, int) or total < 1:
        return False
    number = record.get('episode')
    if number is None and total == 1:
        number = 1
    if not safe_episode_record({**record, 'episode': number}) or number > total:
        return False
    filename = parse_archive_fields(record.get('name') or '', '', record.get('id') or 0,
                                    record.get('size'), record.get('date', ''))
    if not filename or filename.get('episode') not in ({None, 1} if total == 1 else {number}):
        return False
    provider = provider or {}
    verified = (isinstance(provider.get('id'), int) and not isinstance(provider.get('id'), bool)
                and provider['id'] > 0 and provider.get('format') in SPECIAL_FORMATS
                and provider.get('status') == 'FINISHED' and provider.get('episodes') == total
                and isinstance((provider.get('startDate') or {}).get('year'), int)
                and normalized(canonical_query(record.get('title'))) in identity_names(provider))
    filename_title = filename['title']
    labeled = bool(SPECIAL_MARKER.search(str(record.get('title') or '')))
    if verified:
        year = provider['startDate']['year']
        years = {int(value) for value in re.findall(r'\b(?:19|20)\d{2}\b', str(record.get('name') or '').replace('_', ' '))}
        if years and years != {year}:
            return False
        if not labeled and years != {year}:
            return False
        # parse_archive_fields trims the closing parenthesis at the end of a
        # title. Only remove this exact provider-confirmed parenthesized year.
        if years == {year}:
            filename_title = re.sub(r'\s*[\[(]' + str(year) + r'[\])]?(?=\s|$)', '', filename_title)
    return bool((labeled or verified)
                and normalized(canonical_query(filename_title)) == normalized(canonical_query(record.get('title'))))


def remake_names(media):
    # Remove a parenthesized year ONLY to detect competing remakes. This never
    # makes an otherwise inexact title eligible for automatic acceptance.
    return {normalized(re.sub(r'\s*[\[(](?:19|20)\d{2}[\])]', '', str(v)))
            for v in (media.get('title') or {}).values() if v}


def adaptation_names(media):
    """Broader names detect a version conflict, never establish equivalence."""
    values = [*(media.get('title') or {}).values(), *(media.get('synonyms') or [])]
    return {normalized(canonical_query(re.sub(r'\s*[\[(](?:(?:19|20)\d{2}|TV|OVA|ONA|SPECIAL)[\])]', '', value, flags=re.I)))
            for value in values if value}


def filename_years(record):
    text = str(record.get('name') or '')
    title, ident = record.get('title'), record.get('id')
    if (title in {'Night Head 2041', 'Night Head 2041 .', 'Night Head2041'}
            and type(ident) is int and 0 < ident <= APPROVED_ALIAS_MAX_RECORD_ID[title]):
        from backfill import ARCHIVE_PREFIX_RE, parse_archive_fields
        parsed = parse_archive_fields(text, '', ident)
        if (parsed and normalized(parsed['title']) == normalized(title)
                and parsed.get('episode') == record.get('episode')):
            # 2041 belongs to this exact official title, not its release year.
            # Other explicit years and changed/later filenames remain checked.
            text = re.sub(r'^\s*Night Head 2041(?=\s*[-–—])', '', ARCHIVE_PREFIX_RE.sub('', text), flags=re.I)
    return {int(year) for year in re.findall(r'\b(?:19|20)\d{2}\b', text)}


def filename_year_cohorts(rows):
    """Separate explicit years without inventing a year for unknown files.

    Every source row remains in exactly one cohort. A file containing conflicting
    years stays conflicting, and unmarked files still face all remake guards.
    """
    groups = defaultdict(list)
    for row in rows:
        groups[tuple(sorted(filename_years(row['parsed'])))].append(row)
    if len(groups) <= 1:
        return [rows]
    return [groups[years] for years in sorted(groups)]


def identity_cohorts(title, rows):
    """Keep unreviewed alias reuse held without blocking the reviewed files."""
    if title not in APPROVED_ALIASES:
        return filename_year_cohorts(rows)
    ceiling = APPROVED_ALIAS_MAX_RECORD_ID.get(title)
    if ceiling is None:
        return [rows]
    reviewed, unreviewed = [], []
    for row in rows:
        ident = row['parsed'].get('id')
        target = reviewed if isinstance(ident, int) and not isinstance(ident, bool) and 0 < ident <= ceiling else unreviewed
        target.append(row)
    return [group for group in (reviewed, unreviewed) if group]


def existing_identities(state, media):
    matches = [(key, anime) for key, anime in state['anime'].items()
               if anime.get('metadataProviderId') == media['id']
               or any(normalized(anime.get(field)) in names(media) for field in ('titleEn', 'titleOriginal'))]
    # Once the exact provider page exists, a separately certified different
    # provider ID is not that page merely because remake titles normalize alike.
    # Unknown identities and duplicate copies of the target ID remain conflicts.
    if any(anime.get('metadataProviderId') == media['id'] for _, anime in matches):
        matches = [(key, anime) for key, anime in matches if anime.get('metadataProviderId') in (None, media['id'])]
    return matches


def choose_identity(title, records, media):
    from backfill import MOVIE_MARKER_RE
    movie_marked = any(record.get('mediaKind') == 'MOVIE' or MOVIE_MARKER_RE.search(
        str(record.get('name') or '') + ' ' + str(record.get('caption') or '')) for record in records)
    if title in APPROVED_ALIASES:
        ceiling = APPROVED_ALIAS_MAX_RECORD_ID.get(title)
        if ceiling is not None and any(isinstance(record.get('id'), bool) or not isinstance(record.get('id'), int)
                or record['id'] <= 0 or record['id'] > ceiling for record in records):
            return None, 'archive-alias-needs-new-file-review'
        ident, year, total, evidence = APPROVED_ALIASES[title]
        approved = [m for m in media if m['id']==ident and m.get('format')==APPROVED_ALIAS_FORMATS.get(title, 'TV') and m.get('status')=='FINISHED'
                    and m.get('episodes')==total and (m.get('startDate') or {}).get('year')==year
                    and (title not in APPROVED_ALIAS_MAL_IDS or m.get('idMal') is None
                         or (type(m['idMal']) is int and m['idMal'] == APPROVED_ALIAS_MAL_IDS[title]))
                    and normalized(evidence) in names(m)]
        if len(approved)!=1 or not records or movie_marked:
            return None, 'approved-alias-evidence-or-episode-bound-failed'
        return approved[0], 'reviewed-exact-season-alias'
    exact = [m for m in media if normalized(canonical_query(title)) in identity_names(m)]
    if not exact:
        return None, 'no-exact-provider-title'
    years = set().union(*(filename_years(record) for record in records))
    if len(years) > 1:
        return None, 'conflicting-file-years'
    # S1 alone does not distinguish the first season of an original from a
    # remake explicitly marketed as "1st Season" (for example Fruits Basket).
    if not years and explicit_markers(title) == {('season', 1)}:
        return None, 'unmarked-remake-year'
    possible_remakes = [m for m in media if m.get('format') in {'TV','TV_SHORT','ONA'} and (
        normalized(title) in remake_names(m) or normalized(canonical_query(title)) in {
            normalized(canonical_query(re.sub(r'\s*[\[(](?:19|20)\d{2}[\])]', '', str(value))))
            for value in (m.get('title') or {}).values() if value})]
    if not years and len({(m.get('startDate') or {}).get('year') for m in possible_remakes}) > 1:
        return None, 'unmarked-remake-year'
    if years:
        exact = [m for m in exact if (m.get('startDate') or {}).get('year') in years]
    if movie_marked and (len(exact) != 1 or exact[0].get('format') != 'MOVIE'):
        return None, 'movie-marker-requires-distinct-movie-identity'
    if len(exact) == 1 and exact[0].get('format') in SPECIAL_FORMATS:
        special = exact[0]
        if any(candidate['id'] != special['id'] and candidate.get('format') in {'TV', 'TV_SHORT', 'ONA', 'MOVIE', *SPECIAL_FORMATS}
               and normalized(canonical_query(title)) in adaptation_names(candidate)
               and (not years or (candidate.get('startDate') or {}).get('year') is None
                    or (candidate.get('startDate') or {}).get('year') in years) for candidate in media):
            return None, 'competing-exact-identity'
        if (special.get('status') == 'FINISHED'
                and isinstance((special.get('startDate') or {}).get('year'), int)
                and records and all(safe_special_record(record, special.get('episodes'), special) for record in records)):
            return special, 'unique-exact-standalone-special-identity'
        return None, 'special-evidence-or-episode-bound-failed'
    if SPECIAL_MARKER.search(title):
        return None, 'special-must-have-distinct-provider-identity'
    if len(exact) == 1 and exact[0].get('format') == 'MOVIE':
        movie = exact[0]
        if movie.get('status') == 'FINISHED' and movie.get('episodes') == 1 and isinstance((movie.get('startDate') or {}).get('year'), int) and records and all(safe_movie_record(record) for record in records):
            return movie, 'unique-exact-single-movie-identity'
        return None, 'ambiguous-or-nonseries-identity'
    # A bare title shared by two TV remakes stays ambiguous, even when the
    # current group contains more episode numbers than the older adaptation.
    serial = [m for m in exact if m.get('format') in {'TV','TV_SHORT','ONA'}]
    if len(serial) != 1:
        return None, 'ambiguous-or-nonseries-identity'
    chosen = serial[0]
    highest = max((r['episode'] for r in records if isinstance(r.get('episode'), int) and not isinstance(r['episode'], bool)), default=0)
    total = chosen.get('episodes')
    if chosen.get('status') == 'NOT_YET_RELEASED' or not isinstance(total,int) or total < highest or highest < 2:
        return None, 'episode-bound-or-unreleased'
    if chosen['id'] in NUMBERING_VARIANTS:
        expected_total, compact_max = NUMBERING_VARIANTS[chosen['id']]
        if total == expected_total and highest <= compact_max and not all(
                (record.get('documentIdentityEvidence') or {}).get('providerId') == chosen['id']
                and (record.get('documentIdentityEvidence') or {}).get('basis') == 'identical-document-id-filename-size'
                for record in records):
            return None, 'numbering-version-needs-file-review'
    if any(m['id'] != chosen['id'] and isinstance(m.get('episodes'),int) and m['episodes'] >= highest for m in exact):
        return None, 'competing-exact-identity'
    return chosen, 'unique-exact-provider-identity'


def compatible_record(anime, record):
    from backfill import MOVIE_MARKER_RE
    stored_special = anime.get('archiveSpecialReference') or {}
    if stored_special and (stored_special.get('id') != anime.get('metadataProviderId')
                           or stored_special.get('format') != anime.get('format')):
        return False
    if not reviewed_record_allowed(anime, record):
        return False
    if not bulk_alias_filename_allowed(record):
        return False
    from archive_numbering_certificates import STONE_OCEAN_TITLE, certified_stone_ocean_source
    if record.get('title') == STONE_OCEAN_TITLE and (not certified_stone_ocean_source(record)
            or anime.get('metadataProviderId') != 146722 or anime.get('year') != 2022
            or anime.get('format') != 'ONA' or anime.get('declaredEpisodes') != 26):
        return False
    from archive_numbering_certificates import SPLIT_TITLES, certified_split_cour_source
    if record.get('title') in SPLIT_TITLES:
        if not certified_split_cour_source(record):
            return False
        proof = record['sourceNumberingEvidence']
        if any(anime.get(field) != proof[evidence] for field,evidence in (
                ('metadataProviderId','providerId'),('year','year'),('format','format'),
                ('declaredEpisodes','providerEpisodes'))):
            return False
    from archive_literal_files import LITERAL_TV_TITLES, reviewed_tv_filename
    if record.get('title') in LITERAL_TV_TITLES:
        literal = reviewed_tv_filename(record)
        if not literal or any(record.get(key) != value for key, value in literal.items()):
            return False
    if conflicts(page_markers(anime), record_markers(record)):
        return False
    if (anime.get('format') != 'MOVIE' and anime.get('type') != 'فیلم'
            and (record.get('mediaKind') == 'MOVIE' or MOVIE_MARKER_RE.search(
                str(record.get('name') or '') + ' ' + str(record.get('caption') or '')))):
        return False
    if anime.get('format') in SPECIAL_FORMATS:
        evidence = anime.get('archiveSpecialReference') or {}
        if (evidence.get('id') != anime.get('metadataProviderId')
                or evidence.get('format') != anime.get('format')
                or (evidence.get('startDate') or {}).get('year') != anime.get('year')):
            evidence = None
        if not safe_special_record(record, anime.get('declaredEpisodes'), evidence):
            return False
    elif SPECIAL_MARKER.search(str(record.get('title') or '') + ' ' + str(record.get('name') or '')):
        return False
    elif anime.get('format') == 'MOVIE' or anime.get('type') == 'فیلم':
        if anime.get('declaredEpisodes') not in (None, 1) or not safe_movie_record(record):
            return False
    elif not safe_episode_record(record) or record['episode'] > (anime.get('declaredEpisodes') or 0):
        return False
    verified=anime.get('verifiedArchiveTitles')
    allowed={normalized(title) for title in verified} if verified else {normalized(anime.get(field)) for field in ('titleEn','titleOriginal') if anime.get(field)}
    if allowed and normalized(record.get('title')) not in allowed:
        return False
    if record.get('title') in APPROVED_FILENAME_TITLES:
        from backfill import parse_archive_fields
        filename = parse_archive_fields(record.get('name') or '', '', record.get('id') or 0)
        if not filename or normalized(filename['title']) != normalized(APPROVED_FILENAME_TITLES[record['title']]):
            return False
    years = filename_years(record)
    if record.get('title') in APPROVED_FILENAME_YEARS and years != {APPROVED_FILENAME_YEARS[record['title']]}:
        return False
    return not years or years == {anime.get('year')}


def search(title):
    media = []
    for page in range(1,4):
        request = urllib.request.Request('https://graphql.anilist.co', data=json.dumps({
            'query':QUERY,'variables':{'search':title,'page':page}}).encode(),
            headers={'Content-Type':'application/json','User-Agent':'AnimeVerse-ArchiveIdentity/1.0'})
        with urllib.request.urlopen(request,timeout=30) as response:
            result = json.load(response)
        if result.get('errors'):
            raise ValueError('Provider query failed')
        data = result['data']['Page'];media.extend(data['media'])
        if not data['pageInfo']['hasNextPage']:
            return media
        time.sleep(2)
    raise ValueError('Provider results incomplete; identity cannot be certified')


def make_plan(db, state, cache, limit, *, only_titles=None):
    lookup = reference_lookup(cache)
    pool = lookup[0]
    # Scope only title selection, never provider candidates, same-title cohorts,
    # existing pages or exact-document peers. This avoids repeating unrelated
    # identity work for a bounded reviewed batch without changing its proofs.
    selected = sorted(set(only_titles)) if only_titles is not None else None
    if selected == []:
        return {'entries': [], 'heldTitles': {}, 'scannedTitles': 0}
    clause = ' AND title IN (' + ','.join('?' for _ in selected) + ')' if selected is not None else ''
    all_titles = [r[0] for r in db.execute("""SELECT json_extract(record,'$.title') AS title FROM files
        WHERE state='copied' AND anime_key IS NULL AND title IS NOT NULL AND title<>''"""
        + clause + ' GROUP BY title ORDER BY count(*) DESC,title', selected or [])]
    held = Counter()
    candidates = []
    for title in all_titles:
        entry=cache.get(title) or {}
        if title in APPROVED_ALIASES:
            candidates.append(title)
        elif not (entry.get('complete') or entry.get('canonicalComplete')):
            held['provider-unavailable']+=1
        elif not any(normalized(canonical_query(title)) in identity_names(media) for media in reference_candidates(title, entry, lookup)):
            held['no-exact-provider-title']+=1
        else:
            candidates.append(title)
    # Permanently ambiguous/high-volume titles must not starve other certified
    # identities deeper in the copied inventory.
    titles=candidates
    rows = defaultdict(list)
    if titles:
        for row in db.execute("SELECT * FROM files WHERE anime_key IS NULL AND json_extract(record,'$.title') IN ("+','.join('?' for _ in titles)+')',titles):
            value=dict(row);value['parsed']=json.loads(value['record']);rows[value['parsed']['title']].append(value)
    plan = exact_document_entries(db, state, pool, limit, only_titles=selected)
    document_ids = {ident for entry in plan for ident in entry['fileIds']}
    for title in rows:
        rows[title] = [row for row in rows[title] if row['id'] not in document_ids]
    for title in titles:
        if len(plan) >= limit:
            break
        entry=cache.get(title) or {}
        if not (entry.get('complete') or entry.get('canonicalComplete')) and title not in APPROVED_ALIASES:
            held['provider-unavailable']+=1;continue
        candidates=list(pool.values()) if title in APPROVED_ALIASES else reference_candidates(title, entry, lookup)
        exact = [m for m in candidates if normalized(canonical_query(title)) in identity_names(m)]
        single_movie = len(exact) == 1 and exact[0].get('format') == 'MOVIE' and exact[0].get('episodes') == 1
        special = exact[0] if len(exact) == 1 and exact[0].get('format') in SPECIAL_FORMATS else None
        cohorts = identity_cohorts(title, rows[title])
        for group in cohorts:
            if len(plan) >= limit:
                break
            safe=[r for r in group if (safe_special_record(r['parsed'], special.get('episodes'), special) if special
                  else safe_movie_record(r['parsed']) if single_movie else safe_episode_record(r['parsed']))]
            media, reason=choose_identity(title,[r['parsed'] for r in safe],candidates)
            if not media:
                held[reason]+=1;continue
            context={'year':media['startDate']['year'],'declaredEpisodes':media['episodes'],'metadataProviderId':media['id'],
                      'format':media['format'],'verifiedArchiveTitles':[title]}
            if media['format'] in SPECIAL_FORMATS:
                context.update(metadataProviderId=media['id'], archiveSpecialReference=media)
            safe=[row for row in safe if compatible_record(context,row['parsed'])]
            existing=[key for key, _ in existing_identities(state, media)]
            if len(existing)>1:
                reviewed_key = APPROVED_ALIAS_TARGET_KEYS.get(title)
                target = state['anime'].get(reviewed_key, {})
                legacy_key, legacy_facts = APPROVED_LEGACY_DUPLICATE_FACTS.get(title, (None, {}))
                exempt_legacy = legacy_key if legacy_key in existing and all(
                    state['anime'][legacy_key].get(field) == value for field, value in legacy_facts.items()) else None
                if (reviewed_key not in existing or target.get('metadataProviderId') != media['id']
                        or target.get('format') != media['format'] or target.get('declaredEpisodes') != media['episodes']
                        or target.get('year') != media['startDate']['year']
                        or any(state['anime'][key].get('metadataProviderId') not in (None, media['id'])
                               or state['anime'][key].get('year') not in (None, media['startDate']['year'])
                               or state['anime'][key].get('format') not in (None, media['format'])
                               or state['anime'][key].get('declaredEpisodes') not in (None, media['episodes'])
                               for key in existing if key != exempt_legacy)):
                    held['multiple-existing-pages']+=1;continue
                existing = [reviewed_key]
            if existing:
                current=state['anime'][existing[0]]
                current_movie = current.get('type') == 'فیلم' or current.get('format') == 'MOVIE'
                if (current_movie != (media['format'] == 'MOVIE') or current.get('format') == 'MUSIC'
                        or ((media['format'] in SPECIAL_FORMATS or current.get('format') in SPECIAL_FORMATS)
                            and current.get('format') != media['format'])):
                    held['existing-page-format-conflict']+=1;continue
                if current.get('metadataProviderId') not in (None, media['id']) or current.get('declaredEpisodes') not in (None, media['episodes']):
                    held['existing-page-provider-or-episode-conflict']+=1;continue
                year=current.get('year')
                if year and year != (media.get('startDate') or {}).get('year'):
                    held['existing-page-year-conflict']+=1;continue
            key=existing[0] if existing else 'al'+str(media['id'])
            binding=db.execute('SELECT anime_key,conflict FROM bindings WHERE title=?',(title,)).fetchone()
            if binding and (binding['conflict'] or binding['anime_key']!=key):
                held['existing-binding-conflict']+=1;continue
            copied=[r for r in safe if r['state']=='copied' and r['destination_id']]
            if not copied:
                held['no-safe-copied-video']+=1;continue
            plan.append({'archiveTitle':title,'key':key,'newTitle':not existing,'providerId':media['id'],
                'copiedFiles':len(copied),'pendingFiles':sum(r['state']=='pending' for r in safe),
                'heldFiles':len(group)-len(safe),'fileIds':[r['id'] for r in safe],
                'metadata':media,'reason':reason})
    return {'entries':plan,'heldTitles':dict(held),'scannedTitles':len(all_titles)}


def apply_plan(state, db, plan):
    """Called only by the sole catalog writer or while its lock is held.

    Bind individual certified file IDs, never a broad title-string binding that
    could silently capture a future remake. Existing assignments are untouched.
    """
    from common import now_iso
    from ingest import _unique_slug
    from quality import clean_season, clean_synopsis
    from archive_pipeline import publish_record
    result = Counter()
    created = []
    for entry in plan['entries']:
        key, media = entry['key'], entry['metadata']
        if key not in state['anime']:
            title = media['title'].get('english') or media['title']['romaji']
            original = media['title'].get('romaji') or title
            state['anime'][key] = {
                'key':key,'aniplusId':'','slug':_unique_slug(state,original,key),'mediaKey':key,
                'createdAt':now_iso(),'updatedAt':now_iso(),'episodes':{},'postIds':[],
                'firstPostId':0,'lastPostId':0,'titleEn':title,'titleFa':title,
                'titleOriginal':original,'titleJa':media['title'].get('native') or '',
                'year':media['startDate']['year'],'season':clean_season(media.get('season')),
                'format':media['format'],'type':'فیلم' if media['format']=='MOVIE' else 'سریال',
                'status':'پایان یافته' if media.get('status')=='FINISHED' else 'در حال پخش',
                'declaredEpisodes':media['episodes'],
                'durationRaw':str(media['duration'])+' دقیقه' if media.get('duration') else '',
                'synopsis':clean_synopsis(media.get('description') or ''),
                'genres':media.get('genres') or [],
                'studio':' / '.join(n['name'] for n in media.get('studios',{}).get('nodes',[]) if n.get('name')),
                'coverUrl':media.get('coverImage',{}).get('large') or '',
                'metadataSource':'anilist','metadataProviderId':media['id'],
                'metadataUrl':'https://anilist.co/anime/'+str(media['id']),
            }
            created.append(key)
        anime=state['anime'][key]
        compatible_missing_format = (not anime.get('format') and (
            (anime.get('type') == 'سریال' and media['format'] in {'TV', 'TV_SHORT', 'ONA'})
            or (anime.get('type') == 'فیلم' and media['format'] == 'MOVIE')))
        serial_formats = {'TV', 'TV_SHORT', 'ONA'}
        compatible_serial_format = anime.get('format') in serial_formats and media['format'] in serial_formats
        # A known scraper defect put the explicitly labelled Persian display
        # name in titleEn. It is not an English identity claim; an independent
        # remaining official title, year/type/total/provider must still agree.
        page_titles = [anime.get(field) for field in ('titleEn', 'titleOriginal') if anime.get(field)
                       and not re.match(r'^\s*نام\s*فارسی\s*[:：]', anime[field])]
        official_names = names(media)
        # One literal legacy scraper typo uses Cyrillic о in Chоujin. Do not
        # apply confusable-character folding to arbitrary titles or pages.
        if (key == 'hkinnikuman' and media.get('id') == 181886 and media.get('idMal') == 59914
                and media.get('format') == 'TV' and media.get('episodes') == 11
                and (media.get('startDate') or {}).get('year') == 2025
                and normalized(anime.get('titleEn')) == normalized('Kinnikuman: Perfect Origin Arc Season 2')
                and anime.get('titleOriginal') == 'Kinnikuman: Kanpeki Chоujin Shiso-hen Season 2'):
            official_names.add(normalized(anime['titleOriginal']))
        def verified_page_title(title):
            alias = APPROVED_ALIASES.get(title)
            return normalized(title) in official_names or bool(alias and alias[:3] == (media['id'], media['startDate']['year'], media['episodes'])
                and APPROVED_ALIAS_FORMATS.get(title, 'TV') == media['format'] and normalized(alias[3]) in official_names)
        if (anime.get('year') == media['startDate']['year'] and (anime.get('format') == media['format'] or compatible_missing_format or compatible_serial_format)
                and page_titles and all(verified_page_title(title) for title in page_titles)
                and anime.get('metadataProviderId') in (None, media['id']) and anime.get('declaredEpisodes') in (None, media['episodes'])
                and any(anime.get(field) is None for field in ('metadataProviderId', 'declaredEpisodes', 'format'))):
            # This page matched exact official titles and start year, with a
            # compatible known type/format. Fill only missing facts; keep
            # its original posts, source, slugs, scores and episode identities.
            anime.update(declaredEpisodes=media['episodes'], metadataProviderId=media['id'], format=anime.get('format') or media['format'],
                metadataEnrichmentSource='anilist', metadataEnrichmentUrl='https://anilist.co/anime/'+str(media['id']))
            result['metadataPagesEnriched'] += 1
        if anime.get('metadataSource')=='anilist' or anime.get('metadataProviderId')==media['id']:
            verified=anime.setdefault('verifiedArchiveTitles',[])
            if entry['archiveTitle'] not in verified:verified.append(entry['archiveTitle'])
        if media['format'] in SPECIAL_FORMATS and anime.get('metadataProviderId') == media['id']:
            anime['archiveSpecialReference'] = {field: media.get(field) for field in (
                'id', 'idMal', 'title', 'synonyms', 'format', 'status', 'episodes', 'startDate')}
        for ident in entry['fileIds']:
            row=db.execute('SELECT * FROM files WHERE id=? AND anime_key IS NULL',(ident,)).fetchone()
            if row is None:
                continue
            accepted = state.get('queue', {}).get('archive:' + str(ident), {})
            if accepted.get('status') == 'done' and accepted.get('url') and accepted.get('animeKey') not in (None, key):
                result['heldFiles'] += 1
                continue
            record=json.loads(row['record'])
            if not compatible_record(anime,record):
                result['heldFiles']+=1;continue
            db.execute('UPDATE files SET anime_key=?,published=0 WHERE id=? AND anime_key IS NULL',(key,ident))
            result['matchedFiles']+=1
            if row['state']=='copied' and row['destination_id']:
                updated=dict(row);updated['anime_key']=key
                if publish_record(state,updated):result['newQualityLinks']+=1
        result['matchedArchiveTitles']+=1
    return {**dict(result),'createdKeys':created}


def reconcile_cached(state, db, limit=200):
    from common import DATA
    path=DATA/'archive-identity-cache.json'
    if not path.exists():
        return {'createdKeys':[]}
    cache=json.loads(path.read_text())
    preservation = {'restoredAssignments': 0, 'heldAssignmentRestorations': 0}
    preservation_path = DATA / 'archive-full-match/assignment-preservation-proposals.json'
    if preservation_path.exists():
        from archive_assignment_preservation import restore_snapshot_assignments
        from common import read_json
        preservation = restore_snapshot_assignments(state, db, cache,
            read_json(preservation_path, {}) or {}, DATA / 'backups')
    recovered = 0
    for name in ('filename-recovery-proposals.json', 'reported-example-recovery-proposals.json'):
        recovery_path = DATA / 'archive-full-match' / name
        if recovery_path.exists():
            from common import read_json
            preview = read_json(recovery_path, {}) or {}
            if preview.get('version') == 1 and isinstance(preview.get('proposals'), list):
                recovered += apply_recovery_proposals(state, db, cache, preview['proposals'])
    enriched = enrich_reviewed_pages(state, cache)
    result = apply_plan(state,db,make_plan(db,state,cache,limit))
    result['sourceRecordsRecovered'] = recovered
    result['metadataPagesEnriched'] = result.get('metadataPagesEnriched', 0) + enriched
    return {**result, **preservation}


def identical_document_proposals(db, state):
    """Exact Telegram document IDs plus identical filename/size, not fuzzy names."""
    groups = defaultdict(list)
    for row in db.execute("""SELECT u.id,u.document_id,u.record,m.id AS peer_id,
        m.record AS peer_record,m.anime_key FROM files u JOIN files m ON m.document_id=u.document_id
        WHERE u.state='copied' AND u.anime_key IS NULL AND m.state='copied' AND m.anime_key IS NOT NULL
        AND u.document_id IS NOT NULL AND u.document_id<>''"""):
        groups[row['id']].append(dict(row))
    proposals = {}
    for ident, peers in groups.items():
        targets = {(row['anime_key'], json.loads(row['peer_record']).get('episode'),
                    json.loads(row['peer_record']).get('quality')) for row in peers}
        if len(targets) != 1:
            continue
        for peer in peers:
            document = str(peer['document_id'])
            if not document.isdigit() or int(document) <= 0:
                continue
            old, trusted = json.loads(peer['record']), json.loads(peer['peer_record'])
            anime = state['anime'].get(peer['anime_key'], {})
            if (not anime.get('metadataProviderId') or not compatible_record(anime, trusted)
                    or not reviewed_record_allowed(anime, trusted, document)):
                continue
            if old.get('name') != trusted.get('name') or not old.get('size') or old['size'] != trusted.get('size'):
                continue
            updated = {**old, **{field: trusted.get(field) for field in (
                'title', 'norm', 'episode', 'season', 'part', 'quality', 'x265', 'hardsub')}}
            if not compatible_record(anime, updated):
                updated['originalCaption'] = old.get('originalCaption', old.get('caption') or '')
                updated['caption'] = ''
            if not compatible_record(anime, updated):
                continue
            updated['documentIdentityEvidence'] = {'documentId': document, 'sourceFileId': peer['peer_id'],
                'animeKey': peer['anime_key'], 'providerId': anime['metadataProviderId'], 'basis': 'identical-document-id-filename-size',
                'originalParsedMetadata': {field: old.get(field) for field in ('title', 'episode', 'season', 'part', 'quality')}}
            proposals[ident] = updated
            break
    return proposals


def exact_document_entries(db, state, pool, limit, *, only_titles=None):
    """Reuse a currently certified exact document, not a title-based inference.

    A single first episode needs no neighbouring episode to establish identity
    when the same document/filename/size is already certified on that page.
    Rebuild the peer proof on every plan; a stored evidence label is not trust.
    No new page or broad title binding can be created by this path.
    """
    clause = " AND json_extract(record,'$.title') IN (" + ','.join('?' for _ in only_titles) + ')' if only_titles is not None else ''
    pending = db.execute("""SELECT id,record,destination_id FROM files
        WHERE state='copied' AND anime_key IS NULL
        AND json_extract(record,'$.documentIdentityEvidence') IS NOT NULL""" + clause, only_titles or []).fetchall()
    if not pending or limit <= 0:
        return []
    trusted = identical_document_proposals(db, state)
    groups = {}
    for row in pending:
        source = json.loads(row['record'])
        current = trusted.get(row['id'])
        if not current or not row['destination_id']:
            continue
        evidence = source.get('documentIdentityEvidence') or {}
        verified = current['documentIdentityEvidence']
        if any(evidence.get(field) != verified.get(field) for field in (
                'documentId', 'sourceFileId', 'animeKey', 'providerId', 'basis')):
            continue
        if any(source.get(field) != current.get(field) for field in (
                'title', 'episode', 'season', 'part', 'quality', 'x265', 'hardsub', 'caption')):
            continue
        key = verified['animeKey']
        anime = state['anime'][key]
        media = pool.get(verified['providerId'])
        if not media or media.get('status') == 'NOT_YET_RELEASED':
            continue
        if (anime.get('metadataProviderId') != media['id'] or anime.get('format') != media.get('format')
                or not isinstance((media.get('startDate') or {}).get('year'), int)
                or isinstance(media['startDate']['year'], bool)
                or anime.get('year') != (media.get('startDate') or {}).get('year')
                or not isinstance(media.get('episodes'), int) or isinstance(media.get('episodes'), bool)
                or media['episodes'] < 1 or anime.get('declaredEpisodes') != media['episodes']
                or not compatible_record(anime, source)):
            continue
        title = source.get('title')
        binding = db.execute('SELECT anime_key,conflict FROM bindings WHERE title=?', (title,)).fetchone()
        if binding and (binding['conflict'] or binding['anime_key'] != key):
            continue
        group_key = (key, title)
        if group_key not in groups:
            if len(groups) >= limit:
                continue
            groups[group_key] = {'archiveTitle': title, 'key': key, 'newTitle': False,
                'providerId': media['id'], 'copiedFiles': 0, 'pendingFiles': 0, 'heldFiles': 0,
                'fileIds': [], 'metadata': media, 'reason': 'recertified-identical-document-id-filename-size'}
        groups[group_key]['fileIds'].append(row['id'])
        groups[group_key]['copiedFiles'] += 1
    return list(groups.values())


def recover_filename_records(db, state, cache, limit=200, file_ids=None):
    """Recover only filename parses that independently pass the identity planner.

    Existing nonempty title/episode/quality fields may not be contradicted. The
    original caption and multi-episode flags remain active safety evidence.
    """
    import tempfile
    # The full archive is too large for nested in-memory SQLite backups on this
    # host. Disk-backed, owner-only scratch keeps the same isolated rehearsal
    # semantics with a bounded SQLite cache and deterministic cleanup.
    with tempfile.TemporaryDirectory(prefix='archive-recovery-', dir='/tmp/opencode') as scratch:
        memory = sqlite3.connect(Path(scratch) / 'rehearsal.sqlite3')
        memory.row_factory = sqlite3.Row
        memory.execute('PRAGMA cache_size=-4096')
        try:
            db.backup(memory)
            proposals = identical_document_proposals(memory, state)
            from archive_video_probe import verified_video_proposals
            proposals.update(verified_video_proposals(memory))
            if file_ids is not None:
                proposals = {ident: record for ident, record in proposals.items() if ident in file_ids}
            reference_index = {}
            for row in memory.execute("SELECT * FROM files WHERE state='copied' AND anime_key IS NULL"):
                if file_ids is not None and row['id'] not in file_ids:
                    continue
                if row['id'] in proposals:
                    continue
                old = json.loads(row['record'])
                updated = (filename_candidate(old, row['id']) or caption_candidate(old, row['id'])
                           or filename_web_candidate(old, row['id'], cache, reference_index))
                if updated:
                    proposals[row['id']] = updated
            for ident, record in proposals.items():
                memory.execute('UPDATE files SET record=? WHERE id=?', (json.dumps(record), ident))
            plan = make_plan(memory, state, cache, limit, only_titles={record['title'] for record in proposals.values()})
            certified = {ident for entry in plan['entries'] for ident in entry['fileIds']
                         if ident not in proposals or not proposals[ident].get('documentIdentityEvidence')
                         or proposals[ident]['documentIdentityEvidence']['animeKey'] == entry['key']} & set(proposals)
            for ident in certified:
                db.execute('UPDATE files SET record=? WHERE id=? AND anime_key IS NULL',
                           (json.dumps(proposals[ident], ensure_ascii=False), ident))
            return len(certified)
        finally:
            memory.close()


def filename_candidate(old, ident):
    """Reparse missing fields only; existing episode/quality contradictions hold."""
    from backfill import parse_archive_fields
    from archive_numbering_certificates import stone_ocean_candidate
    numbered_tv = stone_ocean_candidate(old) if ident == old.get('id') else None
    if numbered_tv:
        return numbered_tv
    from archive_numbering_certificates import split_cour_candidate
    split_tv = split_cour_candidate(old) if ident == old.get('id') else None
    if split_tv:
        return split_tv
    from archive_literal_files import baccano_special_filename, reviewed_tv_candidate
    reviewed = reviewed_tv_candidate(old) if ident == old.get('id') else None
    if reviewed:
        return reviewed
    numbered = baccano_special_filename(old)
    if (numbered and ident == old.get('id') and old.get('title') == 'Baccano!'
            and old.get('episode') == numbered['sourceNumberingEvidence']['overallEpisode']):
        return {**old, **numbered}
    if safe_episode_record(old):
        return None
    parsed = parse_archive_fields(old.get('name') or '', '', ident, old.get('size'), old.get('date', ''))
    if not parsed:
        return None
    if old.get('title') and normalized(old['title']) != normalized(parsed['title']):
        base = re.sub(r'\b(?:S\s*|Season\s+)\d{1,2}\b', '', parsed['title'], flags=re.I)
        if not explicit_markers(parsed['title']) or normalized(base) != normalized(old['title']):
            return None
        if explicit_markers(old['title']) - explicit_markers(parsed['title']):
            return None
    if old.get('episode') is not None and old['episode'] != parsed['episode']:
        return None
    if old.get('quality') and old['quality'] != parsed['quality']:
        return None
    if any(old.get(field) is not None and old[field] != parsed.get(field) for field in ('season', 'part')):
        return None
    updated = {**old, **parsed, 'caption': old.get('caption') or ''}
    return updated if safe_episode_record(updated) else None


def filename_web_candidate(old, ident, cache, reference_index=None):
    """A full filename may resolve an unverified caption alias, never a conflict.

    Both names need completed searches. A known different caption identity,
    changed episode/quality or erased sequence marker fails closed. The caller
    still certifies every proposed file with the normal group identity planner.
    """
    from backfill import parse_archive_fields
    from season_identity import sequence_markers, roman_tokens
    parsed = parse_archive_fields(old.get('name') or '', '', ident, old.get('size'), old.get('date', ''))
    if not parsed or not old.get('title') or normalized(parsed['title']) == normalized(old['title']):
        return None
    if old.get('episode') is not None and old['episode'] != parsed.get('episode'):
        return None
    if old.get('quality') and old['quality'] != parsed.get('quality'):
        return None
    if any(old.get(field) is not None and old[field] != parsed.get(field) for field in ('season', 'part')):
        return None
    if sequence_markers(old['title']) - sequence_markers(parsed['title']):
        return None
    if {value.upper() for value in roman_tokens(old['title'])} - {value.upper() for value in roman_tokens(parsed['title'])}:
        return None
    if {value.upper() for value in re.findall(r'\bR\d+\b', old['title'], re.I)} - {value.upper() for value in re.findall(r'\bR\d+\b', parsed['title'], re.I)}:
        return None
    reference_index = reference_index if reference_index is not None else {}
    lookup_key = ('complete-primary-reference-lookup',)
    if lookup_key not in reference_index:
        reference_index[lookup_key] = reference_lookup(cache)
    def exact_ids(title):
        if title not in reference_index:
            entry = cache.get(title) or {}
            if not (entry.get('complete') or entry.get('canonicalComplete')):
                reference_index[title] = None
            else:
                reference_index[title] = {media['id'] for media in reference_candidates(title, entry, reference_index[lookup_key])
                    if normalized(canonical_query(title)) in identity_names(media)}
                if title in APPROVED_ALIASES:
                    reference_index[title].add(APPROVED_ALIASES[title][0])
        return reference_index[title]
    old_ids, new_ids = exact_ids(old['title']), exact_ids(parsed['title'])
    if old_ids is None or not new_ids or (old_ids and not new_ids <= old_ids):
        return None
    updated = {**old, **parsed, 'caption': old.get('caption') or ''}
    return updated if safe_episode_record(updated) or safe_movie_record(updated) else None


def caption_candidate(old, ident):
    """Recover a missing episode from the unchanged source caption/title only.

    No title/season/quality remap is allowed. The filename must name that same
    title; ambiguous prefixes and alternative names need separate reference proof.
    Filename episode/range/resolution and codec contradictions still fail.
    """
    from backfill import parse_archive_fields
    from resolver import _quality_of
    if not old.get('title') or not old.get('caption') or old.get('episode') is not None:
        return None
    parsed = parse_archive_fields(old.get('name') or '', old['caption'], ident,
                                  old.get('size'), old.get('date', ''))
    if not parsed or normalized(parsed['title']) != normalized(old['title']):
        return None
    if old.get('quality') and old['quality'] != parsed.get('quality'):
        return None
    if any(old.get(key) is not None and old[key] != parsed.get(key) for key in ('season', 'part')):
        return None
    filename = parse_archive_fields(old.get('name') or '', '', ident, allow_incomplete=True)
    if not filename or normalized(canonical_query(filename['title'])) != normalized(canonical_query(old['title'])):
        return None
    if _quality_of(old.get('name') or '')[1] and not parsed.get('x265'):
        return None
    if any(old.get(key) is True and not parsed.get(key) for key in ('x265', 'hardsub')):
        return None
    parsed['title'] = old['title']
    parsed['norm'] = old.get('norm') or normalized(old['title'])
    updated = {**old, **parsed, 'name': old.get('name') or '', 'caption': old['caption']}
    return updated if safe_episode_record(updated) else None


def apply_recovery_proposals(state, db, cache, proposals):
    """Sole-writer replay of an offline preview, independently certified again.

    No backups of an active write transaction are needed. A savepoint restores
    every proposal not accepted by the current identity planner. Original source
    metadata is preserved on accepted records; existing assignments never move.
    """
    import hashlib
    from common import now_iso
    if not proposals:
        return 0
    trusted_documents = identical_document_proposals(db, state) if any(
        item.get('record', {}).get('documentIdentityEvidence') for item in proposals) else {}
    from archive_video_probe import verified_video_proposals
    trusted_videos = verified_video_proposals(db) if any(
        item.get('record', {}).get('videoMetadataEvidence') for item in proposals) else {}
    originals = {}
    reference_index = {}
    db.execute('SAVEPOINT archive_filename_recovery')
    try:
        for item in proposals:
            ident = item.get('id')
            if isinstance(ident, bool) or not isinstance(ident, int) or ident in originals:
                continue
            row = db.execute('SELECT record FROM files WHERE id=? AND state=\'copied\' AND anime_key IS NULL', (ident,)).fetchone()
            if row is None or hashlib.sha256(row['record'].encode()).hexdigest() != item.get('originalSha256'):
                continue
            old = json.loads(row['record'])
            candidate = (trusted_documents.get(ident) or trusted_videos.get(ident)
                         or filename_candidate(old, ident) or caption_candidate(old, ident)
                         or filename_web_candidate(old, ident, cache, reference_index))
            if candidate is None or candidate != item.get('record'):
                continue
            originals[ident] = row['record']
            if not isinstance(candidate.get('archiveRecovery'), dict):
                candidate = {**candidate, 'archiveRecovery': {'originalRecord': old, 'originalSha256': item['originalSha256'], 'reviewedAt': now_iso()}}
            db.execute('UPDATE files SET record=? WHERE id=? AND anime_key IS NULL', (json.dumps(candidate, ensure_ascii=False), ident))
        if originals:
            recovered_titles = {json.loads(db.execute('SELECT record FROM files WHERE id=?', (ident,)).fetchone()[0])['title']
                                for ident in originals}
            plan = make_plan(db, state, cache, max(200, len(proposals)), only_titles=recovered_titles)
            certified = {ident for entry in plan['entries'] for ident in entry['fileIds']
                         if ident not in trusted_documents
                         or trusted_documents[ident]['documentIdentityEvidence']['animeKey'] == entry['key']}
            for ident in originals.keys() - certified:
                db.execute('UPDATE files SET record=? WHERE id=? AND anime_key IS NULL', (originals[ident], ident))
            recovered = len(originals.keys() & certified)
        else:
            recovered = 0
        db.execute('RELEASE SAVEPOINT archive_filename_recovery')
        return recovered
    except Exception:
        db.execute('ROLLBACK TO SAVEPOINT archive_filename_recovery')
        db.execute('RELEASE SAVEPOINT archive_filename_recovery')
        raise


def apply_cached(limit, recover_filenames=False):
    import fcntl
    import os
    import shutil
    from concurrent.futures import ThreadPoolExecutor
    from common import DATA, ROOT, STATE_PATH, atomic_write_json, load_state, now_iso, save_state
    from catalog import build_catalog, write_catalog
    from media import ensure_cover
    from sync import acquire_lock, release_lock
    from archive_pipeline import open_db
    os.umask(0o077)
    with (DATA/'archive-pipeline.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX | fcntl.LOCK_NB)
        if not acquire_lock('archive-identity',0):
            raise SystemExit('Stop the live catalog writer before applying identity matches')
        db=None
        try:
            backup=DATA/'backups'/('archive-identity-'+str(time.time_ns()))
            backup.mkdir(parents=True,mode=0o700)
            for path in [STATE_PATH,ROOT/'src/lib/real-catalog.json',DATA/'aniplus-links.json']:
                if path.exists():shutil.copy2(path,backup/path.name)
            db=open_db()
            with sqlite3.connect(backup/'pipeline.sqlite3') as destination:db.backup(destination)
            state=load_state();before=build_catalog(state)
            original_queue=set(state.get('queue',{}))
            cache=json.loads((DATA/'archive-identity-cache.json').read_text())
            with db:
                enriched = enrich_reviewed_pages(state, cache)
                recovered = recover_filename_records(db,state,cache,limit) if recover_filenames else 0
                plan=make_plan(db,state,cache,limit)
                result=apply_plan(state,db,plan)
                result['sourceRecordsRecovered'] = recovered
                result['metadataPagesEnriched'] = result.get('metadataPagesEnriched', 0) + enriched
                def cover(key):
                    anime=state['anime'][key]
                    assets=ensure_cover(anime['mediaKey'],anime.get('coverUrl') or '')
                    if assets:
                        anime['cover'],anime['banner']=assets
                        anime['coverSource']=anime['coverUrl']
                    return bool(assets)
                with ThreadPoolExecutor(max_workers=3) as pool:
                    result['localCoversPrepared']=sum(pool.map(cover,result['createdKeys']))
                assert original_queue <= set(state.get('queue',{})), 'Existing archive queue identities changed'
                save_state(state)
                after,_=write_catalog(state)
            count=lambda rows: {'titles':len(rows),'episodes':sum(len(r['episodeData']) for r in rows),
                'qualityOptions':sum(len(e['qualities']) for r in rows for e in r['episodeData'])}
            before_count,after_count=count(before),count(after)
            report={'updatedAt':now_iso(),**result,'before':before_count,'after':after_count,
                'delta':{key:after_count[key]-before_count[key] for key in before_count},
                'heldTitles':plan['heldTitles'],'newSlugs':[state['anime'][key]['slug'] for key in result['createdKeys']],
                'backup':str(backup),'publicDeploymentVerified':False}
            atomic_write_json(DATA/'archive-identity-applied.json',report)
            print('ARCHIVE_IDENTITIES_APPLIED',json.dumps(report,ensure_ascii=False),flush=True)
        finally:
            if db:db.close()
            release_lock('archive-identity')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--limit',type=int,default=40)
    parser.add_argument('--cached-only',action='store_true')
    parser.add_argument('--apply',action='store_true')
    parser.add_argument('--resume-wait',action='store_true',help='Obey provider cooldowns and resume the bounded metadata batch')
    parser.add_argument('--recover-filenames',action='store_true',help='Recover only certified filename parses or identical documents')
    args=parser.parse_args()
    if args.apply:
        if not args.cached_only:
            parser.error('--apply requires --cached-only; fetch metadata before stopping the writer')
        apply_cached(max(1,min(args.limit,200)),args.recover_filenames)
        return
    from common import DATA, atomic_write_json, load_state, now_iso
    cache_path=DATA/'archive-identity-cache.json'
    cache=json.loads(cache_path.read_text()) if cache_path.exists() else {}
    db=sqlite3.connect('file:'+str(DATA/'archive-pipeline.sqlite3')+'?mode=ro',uri=True);db.row_factory=sqlite3.Row
    titles=[r[0] for r in db.execute("""SELECT json_extract(record,'$.title') AS title FROM files
        WHERE state='copied' AND anime_key IS NULL AND title IS NOT NULL AND title<>''
        GROUP BY title ORDER BY count(*) DESC,title""") if not cache.get(r[0],{}).get('complete')][:max(1,min(args.limit,200))]
    if not args.cached_only:
        for title in titles:
            if cache.get(title,{}).get('complete'):
                continue
            for attempt in range(3):
                blocked=cache.get('__provider__',{}).get('blockedUntil',0)-time.time()
                if blocked>0:
                    if not args.resume_wait:
                        print('IDENTITY_PROVIDER_COOLDOWN_ACTIVE',round(blocked),flush=True)
                        break
                    print('IDENTITY_PROVIDER_COOLDOWN_RESPECTED',round(blocked),flush=True)
                    time.sleep(blocked)
                try:
                    cache.setdefault(title,{}).update(media=search(title),complete=True,checkedAt=now_iso(),error='')
                    print('IDENTITY_METADATA_CHECKED',title,flush=True)
                    break
                except Exception as error:
                    cache.setdefault(title,{}).update(complete=False,error=type(error).__name__,checkedAt=now_iso())
                    print('IDENTITY_METADATA_DEFERRED',title,type(error).__name__,flush=True)
                    if getattr(error,'code',None)==429:
                        headers=getattr(error,'headers',{}) or {}
                        retry=headers.get('Retry-After','')
                        reset=headers.get('X-RateLimit-Reset','')
                        until=max(time.time()+120, time.time()+int(retry) if str(retry).isdigit() else 0,
                                  int(reset)+2 if str(reset).isdigit() else 0)
                        if retry and not str(retry).isdigit():
                            try:until=max(until,parsedate_to_datetime(retry).timestamp()+2)
                            except (ValueError,TypeError):pass
                        cache['__provider__']={'blockedUntil':until,'reason':'HTTP 429'}
                        atomic_write_json(cache_path,cache)
                        if args.resume_wait and attempt<2:
                            continue
                    break
            atomic_write_json(cache_path,cache)
            if cache.get('__provider__',{}).get('blockedUntil',0)>time.time() and (not args.resume_wait or not cache.get(title,{}).get('complete')):
                break
            time.sleep(4)
    plan=make_plan(db,load_state(),cache,args.limit);db.close()
    plan['updatedAt']=now_iso()
    atomic_write_json(DATA/'archive-identity-plan.json',plan)
    summary={**plan,'entries':[{k:v for k,v in entry.items() if k not in {'metadata','fileIds'}} for entry in plan['entries']]}
    print('IDENTITY_PLAN',json.dumps(summary,ensure_ascii=False),flush=True)


if __name__=='__main__':
    main()
