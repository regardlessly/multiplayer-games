'use strict';

/**
 * Boggle engine — server-authoritative.
 *
 * Rules:
 *  - 2–4 players, 4×4 letter grid (standard Boggle dice).
 *  - 3-minute round timer (180s). All players submit words simultaneously.
 *  - Words must be ≥3 letters, formed by adjacent (including diagonal) cells,
 *    no cell reused in the same word.
 *  - Words not in dictionary = invalid. Duplicate across players = cancelled
 *    (standard Boggle rule: only unique words score).
 *  - Scoring: 3=1pt, 4=1pt, 5=2pt, 6=3pt, 7=5pt, 8+=11pt
 *  - Winner: highest score after deduplication.
 *
 * Interface:
 *   createGame(playerCount)   → engine object
 *   engine.state()            → { board, timeLeft, submissions, isGameOver, scores, … }
 *   engine.submitWord(seat, word) → { ok, reason }
 *   engine.endRound()         → { scores, words } — called by server timer
 *   engine.isGameOver()       → bool
 *   engine.winner()           → seat index | null
 */

// ── Boggle dice (standard 16-die set) ────────────────────────────────────────
const DICE = [
  'AAEEGN', 'ELRTTY', 'AOOTTW', 'ABBJOO',
  'EHRTVW', 'CIMOTU', 'DISTTY', 'EIOSST',
  'DELRVY', 'ACHOPS', 'HIMNQU', 'EEINSU',
  'EEGHNW', 'AFFKPS', 'HLNNRZ', 'DEILRX'
];

// ── Embedded word list (common English words 3-8 letters) ────────────────────
// We ship a curated ~3000-word set. "QU" is treated as a single face.
// The list is generated from common Boggle-valid words.
const WORD_SET = new Set([
  // 3-letter
  'THE','AND','FOR','ARE','BUT','NOT','YOU','ALL','CAN','HER','WAS','ONE','OUR',
  'OUT','DAY','GET','HAS','HIM','HIS','HOW','ITS','LET','MAN','NEW','NOW','OLD',
  'SEE','TWO','WAY','WHO','BOY','DID','ITS','PUT','SAY','SHE','TOO','USE',
  'ACE','ACT','ADD','AGE','AGO','AID','AIM','AIR','ALE','ANT','APE','APT',
  'ARC','ARK','ARM','ART','ASH','ASK','ATE','AWE','AXE','AYE',
  'BAD','BAG','BAN','BAR','BAT','BAY','BED','BEG','BET','BID','BIG','BIT',
  'BOW','BOX','BUD','BUG','BUN','BUS','BUT','BUY',
  'CAB','CAM','CAP','CAR','CAT','COB','COD','COG','COP','COT','COW','CRY','CUB','CUP','CUR','CUT',
  'DAB','DAD','DAM','DEN','DEW','DIG','DIM','DIP','DOE','DOG','DOT','DRY','DUB','DUG','DUO','DYE',
  'EAR','EAT','EEL','EGG','EGO','ELK','ELM','EMU','END','ERA','EVE',
  'FAD','FAN','FAR','FAT','FAX','FAY','FED','FEW','FIG','FIN','FIT','FLY','FOB','FOE','FOG','FOR',
  'FUN','FUR',
  'GAB','GAG','GAP','GAS','GAY','GEL','GEM','GIG','GIN','GNU','GOB','GOD','GOT','GUM','GUN','GUT','GUY',
  'HAD','HAM','HAS','HAT','HAY','HEN','HEP','HEW','HID','HIP','HIT','HOB','HOD','HOG','HOP','HOT',
  'HUB','HUG','HUM','HUT',
  'ICE','ICY','ILL','IMP','INK','INN','ION','IRE','IRK',
  'JAB','JAG','JAM','JAR','JAW','JAY','JET','JIG','JOB','JOG','JOT','JOY','JUG','JUT',
  'KEG','KIT',
  'LAB','LAD','LAG','LAP','LAW','LAX','LAY','LEA','LED','LEG','LET','LID','LIP','LIT','LOG','LOT','LOW',
  'MAC','MAD','MAP','MAR','MAT','MAW','MAY','MEN','MET','MEW','MID','MIX','MOB','MOD','MOP','MOW',
  'MUD','MUG','MUM',
  'NAB','NAG','NAP','NAY','NET','NIB','NIT','NOB','NOD','NOR','NOT','NOV','NOW','NUN','NUT',
  'OAK','OAR','OAT','ODD','ODE','OFT','OHM','OIL','OLD','OPT','ORB','ORE','OWE','OWL','OWN',
  'PAD','PAL','PAN','PAP','PAR','PAT','PAW','PAY','PEA','PEG','PEN','PEP','PET','PIE','PIG','PIN',
  'PIT','PLY','POD','POP','POT','POW','PRY','PUB','PUG','PUN','PUP','PUS','PUT',
  'RAG','RAM','RAN','RAP','RAT','RAW','RAY','RED','REP','RIB','RID','RIG','RIM','ROB','ROD','ROE',
  'ROT','ROW','RUB','RUG','RUM','RUN','RUT','RYE',
  'SAC','SAD','SAG','SAP','SAT','SAW','SAY','SEA','SET','SEW','SIN','SIP','SIT','SIX','SKI','SKY',
  'SLY','SOB','SOD','SON','SOP','SOT','SOW','SOY','SPA','SPY','STY','SUB','SUM','SUN','SUP',
  'TAB','TAD','TAN','TAP','TAR','TAT','TAX','TEA','TEN','THE','TIE','TIN','TIP','TOE','TON','TOP',
  'TOT','TOW','TOY','TUB','TUG','TUN',
  'URN','USE',
  'VAN','VAT','VET','VIA','VIE',
  'WAD','WAR','WAS','WAX','WEB','WED','WET','WHO','WHY','WIG','WIN','WIT','WOE','WOK','WON','WOO','WOW',
  'YAK','YAM','YAP','YAW','YEA','YEW','YOB',
  'ZAP','ZAX','ZED','ZEN','ZIT','ZOO',
  // 4-letter
  'ABLE','ACHE','ACID','ACNE','ACRE','ACTS','AGED','AGES','AIDE','AIDS','AIMS','AIRS',
  'AIRY','AKIN','ALOE','ALSO','ALTO','ALUM','AMEN','AMID','AMPS','ANAL','ANDS',
  'ANEW','ANTE','ANTS','ANUS','APEX','ARCH','AREA','ARES','ARID','ARKS','ARMS',
  'ARMY','ARTS','ARTY','AWED','AWES','AXES','AXIS',
  'BABY','BACK','BADE','BAIL','BAIT','BAKE','BALD','BALE','BALL','BALM','BAND',
  'BANE','BANG','BANS','BARE','BARK','BARN','BASE','BASH','BASK','BASS','BATS',
  'BAUD','BAWL','BAYS','BEAM','BEAN','BEAR','BEAT','BEDS','BEEF','BEEN','BEER',
  'BEES','BEET','BELL','BELT','BEND','BEST','BIDE','BILE','BILL','BIND','BIRD',
  'BITE','BITS','BLOB','BLOC','BLOG','BLOW','BLUE','BLUR','BOAR','BODE','BODY',
  'BOLD','BOLT','BONE','BOON','BOOR','BOOT','BORE','BORN','BOSS','BOTH','BOUT',
  'BOWL','BRAG','BRAN','BRAT','BRAY','BRED','BREW','BRIM','BUCK','BULK','BULL',
  'BUMP','BUNK','BUNT','BURG','BURN','BURP','BURR','BURY','BUSH','BUST','BUSY',
  'CAFE','CAGE','CAKE','CALF','CALL','CALM','CAME','CAMP','CANE','CAPE','CARD',
  'CARE','CARP','CART','CASE','CASH','CAST','CAVE','CELL','CENT','CHAD','CHEF',
  'CHIN','CHIP','CHOP','CHOW','CITE','CITY','CLAD','CLAM','CLAP','CLAW','CLAY',
  'CLEF','CLIP','CLOD','CLOG','CLOP','CLUB','CLUE','COAL','COAT','COIL','COIN',
  'COLA','COLD','COME','CONE','COOK','COOL','COPE','COPY','CORD','CORE','CORN',
  'COST','COSY','COUP','COVE','COWL','COZY','CRAB','CRAM','CRAW','CREW','CROP',
  'CROW','CRUD','CUBE','CUFF','CURE','CURL','CYST',
  'DACE','DAIS','DALE','DAME','DAMP','DARE','DARK','DARN','DART','DASH','DATA',
  'DATE','DAWN','DAYS','DAZE','DEAD','DEAF','DEAL','DEAN','DEAR','DEBT','DECK',
  'DEED','DEEM','DEEP','DEER','DEFT','DELI','DEMO','DENY','DESK','DIEM','DIET',
  'DIGS','DIME','DINE','DIRE','DIRT','DISC','DISH','DISK','DOCK','DOES','DOLE',
  'DONE','DOOM','DOOR','DORK','DOSE','DOTE','DOTH','DOVE','DOWN','DOZE','DRAG',
  'DRAW','DREW','DRIP','DROP','DRUM','DUAL','DUDE','DUEL','DUKE','DULL','DULY',
  'DUMB','DUNE','DUNK','DUSK','DUST','DUTY',
  'EACH','EARL','EARN','EASE','EAST','EASY','EAVE','EDGY','EDIT','EMIT',
  'EPIC','EVEN','EVER','EVIL','EXAM',
  'FACE','FACT','FADE','FAIL','FAIR','FAKE','FAME','FANG','FARM','FAST','FATE',
  'FAWN','FEAR','FEAT','FEED','FEEL','FEET','FELL','FELT','FERN','FEUD','FIFE',
  'FILL','FILM','FIND','FINE','FIRE','FIRM','FISH','FIST','FLAB','FLAW','FLAY',
  'FLEA','FLED','FLEW','FLEX','FLIP','FLIT','FLOG','FLOP','FLOW','FLUB','FLUE',
  'FOAM','FOES','FOLD','FOLK','FOND','FONT','FOOL','FORD','FORE','FORK','FORM',
  'FORT','FOUL','FOUR','FOWL','FRAY','FREE','FRET','FROM','FUEL','FULL','FUND',
  'FUSE','FUSS','FUZZ',
  'GAIT','GALE','GALL','GAME','GAMY','GARB','GASH','GAZE','GELD','GERM','GILD',
  'GILL','GILT','GIVE','GLAD','GLEE','GLEN','GLIB','GLOB','GLOW','GLUE','GLUM',
  'GNAT','GOAD','GOAL','GOES','GOLD','GOLF','GORE','GORY','GOWN','GRAB','GRAM',
  'GRAY','GREW','GRIM','GRIN','GRIP','GRIT','GROG','GROW','GRUB','GULF','GULL',
  'GULP','GUST','GUTS',
  'HACK','HAIL','HAIR','HALF','HALL','HALO','HALT','HAND','HANG','HARD','HARE',
  'HARM','HARP','HASH','HASP','HAST','HATE','HAVE','HAWK','HAZE','HAZY','HEAD',
  'HEAP','HEAR','HEAT','HEEL','HELM','HELP','HERB','HERD','HERE','HERO','HIGH',
  'HIKE','HILL','HILT','HIVE','HOAX','HOCK','HOLD','HOLE','HOLY','HOME','HOOD',
  'HOOK','HOOP','HORN','HOST','HOUR','HOWL','HUGE','HULL','HUMP','HUNT','HURL',
  'HYMN',
  'IDEA','IDLE','IDOL','INCH','INFO','INTO','IRON',
  'JADE','JAIL','JEST','JOIN','JOKE','JOLT','JUNK','JURY','JUST',
  'KEEN','KEEP','KELP','KEPT','KERN','KIND','KING','KISS','KITE','KNIT','KNOB',
  'KNOT','KNOW',
  'LACE','LACK','LADS','LAKE','LAME','LAMP','LAND','LANE','LARD','LARK','LASS',
  'LAST','LATE','LAUD','LAVA','LAWN','LAZE','LAZY','LEAD','LEAF','LEAK','LEAN',
  'LEAP','LEER','LEFT','LEND','LENT','LESS','LEST','LEVY','LICK','LIFE','LIFT',
  'LIKE','LIME','LIMP','LINE','LINK','LINT','LION','LIST','LIVE','LOAD','LOAM',
  'LOAN','LOFT','LONE','LONG','LOOM','LOON','LOOP','LORE','LORN','LOSE','LOSS',
  'LOST','LOUD','LOUT','LOVE','LUCK','LUGE','LULL','LUMP','LURE','LURK','LUST',
  'LUTE',
  'MACE','MADE','MAKE','MALE','MALT','MANY','MARE','MARK','MARS','MAST','MATE',
  'MATH','MAZE','MEAD','MEAL','MEAN','MEAT','MEET','MELT','MEMO','MENU','MESH',
  'MILD','MILE','MILK','MILL','MIME','MIND','MINE','MINT','MIRE','MISS','MIST',
  'MOAN','MOAT','MODE','MOLD','MOLE','MONK','MOOD','MOON','MOOR','MORE','MOSS',
  'MOST','MOTH','MOVE','MUCH','MUCK','MUFF','MULE','MUST','MUTE',
  'NAIL','NAME','NAPE','NEAR','NEAT','NERD','NEST','NEXT','NODE','NOME','NOON',
  'NORM','NOSE','NOTE','NOUN','NUDE','NULL',
  'OATH','OBOE','ODDS','ODES','OILS','OMEN','ONCE','ONLY','OPEN','ORAL','ORBS',
  'ORES','OVEN','OVER','OWED','OWES','OWNS',
  'PACE','PACK','PAGE','PAID','PAIL','PAIN','PAIR','PALE','PALM','PANE','PANG',
  'PARK','PART','PASS','PAST','PATH','PAVE','PAWN','PEAL','PEAR','PECK','PEEL',
  'PEEL','PEER','PELT','PEON','PERK','PEST','PIKE','PILE','PILL','PINE','PINK',
  'PINT','PIPE','PLAN','PLAT','PLAY','PLEA','PLOD','PLOT','PLOW','PLUG','PLUM',
  'PLUS','POKE','POLE','POLL','POND','PONE','PORE','PORT','POSE','POUT','PREY',
  'PROD','PROP','PROW','PULL','PULP','PUMP','PUNT','PURE','PUSH',
  'QUAD','QUAY',
  'RACE','RACK','RAFT','RAGE','RAID','RAIL','RAIN','RAKE','RAMP','RANG','RANK',
  'RANT','RASP','RATE','RAVE','RAYS','READ','REAL','REAP','REEL','REIN','RELY',
  'RENT','REST','RICE','RICH','RIDE','RIFE','RIFT','RING','RIOT','RISE','RISK',
  'ROAD','ROAM','ROAR','ROBE','ROCK','ROLE','ROLL','ROOF','ROOK','ROOM','ROPE',
  'ROSE','ROUT','ROVE','RUIN','RULE','RUNG','RUSH',
  'SACK','SAFE','SAGE','SAIL','SAKE','SALE','SALT','SAME','SAND','SANE','SANG',
  'SANK','SASH','SAVE','SCAN','SCAR','SEAM','SEAR','SEED','SEEK','SEEM','SEEN',
  'SEEP','SELL','SEND','SHED','SHIN','SHIP','SHOE','SHOP','SHOT','SHOW','SHUT',
  'SICK','SIDE','SIFT','SIGH','SILK','SILL','SILO','SING','SINK','SITE','SIZE',
  'SKID','SKIM','SKIN','SKIP','SLAB','SLAG','SLAP','SLAT','SLAW','SLAY','SLIM',
  'SLIP','SLOB','SLOT','SLOW','SLUG','SLUR','SMUG','SNAG','SNAP','SNOB','SNUB',
  'SOAK','SOAR','SOCK','SOFT','SOIL','SOLD','SOLE','SOME','SONG','SOON','SOOT',
  'SORE','SORT','SOUL','SOUP','SOUR','SPAN','SPAR','SPAT','SPEC','SPED','SPIN',
  'SPIT','SPOT','SPUD','SPUR','STAB','STAR','STAY','STEM','STEP','STEW','STIR',
  'STOP','STUB','STUD','STUN','SUCK','SUIT','SULK','SUNG','SUNK','SURF','SWAM',
  'SWAP','SWAT','SWAY','SWIM','SWUM',
  'TACK','TAME','TANG','TANK','TAPE','TARE','TART','TASK','TAUT','TEAK','TEAL',
  'TEAM','TEAR','TECH','TELL','TEND','TENT','TERM','THAN','THAT','THEM','THEN',
  'THEY','THIN','THIS','THUS','TIDE','TIED','TIER','TILL','TILT','TIME','TINY',
  'TIRE','TOIL','TOLD','TOLL','TOME','TONE','TONG','TOOL','TOOT','TORE','TORN',
  'TOSS','TOUR','TOWN','TRAP','TRAY','TREE','TREK','TRIM','TRIO','TRIP','TROD',
  'TROT','TRUE','TUBE','TUCK','TUNE','TURF','TUSK','TUTU','TWIN','TWIT',
  'UGLY','UNDO','UNIT','UPON','URGE','USED','USER',
  'VAIN','VALE','VANE','VASE','VAST','VEER','VEIL','VEIN','VENT','VERB','VERY',
  'VEST','VIBE','VILE','VINE','VOID','VOLE','VOLT','VOTE',
  'WADE','WAFT','WAGE','WAKE','WALK','WALL','WAND','WANE','WARD','WARM','WARN',
  'WARP','WART','WARY','WAVE','WELD','WELL','WEND','WENT','WERE','WEST','WHET',
  'WHIM','WHIP','WHIZ','WICK','WIDE','WILE','WILL','WILT','WINE','WING','WINK',
  'WIRE','WISE','WISH','WITH','WOKE','WOMB','WOOD','WOOL','WORD','WORE','WORK',
  'WORM','WORN','WOVE','WRAP','WREN','WRIT',
  'YARD','YARN','YAWN','YEAR','YELL','YELP','YORE','YOUO',
  'ZEAL','ZERO','ZINC','ZONE','ZOOM',
  // 5-letter
  'ABOUT','ABOVE','ABUSE','ACUTE','ADMIT','ADOPT','ADULT','AFTER','AGAIN','AGATE',
  'AGILE','AGLOW','AGREE','AHEAD','ALERT','ALIKE','ALIEN','ALIGN','ALIVE','ALLAY',
  'ALLOT','ALLOW','ALONE','ALONG','ALTER','ANGEL','ANGER','ANGLE','ANGRY','ANIME',
  'ANNEX','ANNOY','ANTIC','ANVIL','AORTA','APPLE','APPLY','APRON','APTLY','ARBOR',
  'ARDOR','AREAL','ARENA','ARGUE','ARISE','ARMOR','AROMA','AROSE','ARRAY','ASKEW',
  'ASSET','ATONE','ATTIC','AUDIO','AUDIT','AVOID','AWAKE','AWARD','AWARE','AWFUL',
  'BADLY','BAKER','BASIC','BATCH','BEACH','BEGAN','BEGIN','BEING','BELOW','BESET',
  'BEVEL','BINGE','BIRCH','BIRDY','BLAND','BLANK','BLAST','BLAZE','BLEAK','BLEND',
  'BLESS','BLIND','BLOCK','BLOOM','BLOWN','BLUNT','BLUSH','BOOST','BOOZE','BOUND',
  'BRAIN','BRAKE','BRAVE','BREAD','BREAK','BREED','BRIBE','BRIDE','BRIEF','BRING',
  'BRISK','BROKE','BROOK','BRUSH','BUDGE','BUILD','BUILT','BUMPY','BUYER',
  'CABLE','CANDY','CARGO','CARRY','CATCH','CAUSE','CHASE','CHEAP','CHEAT','CHECK',
  'CHEST','CHIEF','CHILD','CHIME','CHIMP','CHOIR','CHORD','CLIMB','CLING','CLOSE',
  'CLOTH','CLOUD','CLOWN','COACH','COAST','COLOR','COMET','COMMA','CORAL','COULD',
  'COUNT','COURT','COVER','CRANK','CRASH','CREAK','CREEK','CRIME','CRIMP','CRISP',
  'CROSS','CROWD','CRUST','CUNNY','CYCLE',
  'DADDY','DAISY','DANCE','DARES','DAILY','DECOY','DELVE','DEPOT','DEPTH','DERBY',
  'DISCO','DODGE','DOING','DONOR','DOUBT','DOUGH','DRAFT','DRAIN','DRAKE','DRAMA',
  'DRANK','DRAPE','DRIVE','DROVE','DROOL','DROWN','DROWN','DRYER','DWARF','DWELL',
  'EAGLE','EARLY','EARTH','ELECT','ELITE','EMOTE','EMPTY','ENEMY','ENJOY','ENTER',
  'EQUAL','EQUIP','ERUPT','EVERY','EXACT','EXIST','EXTRA',
  'FABLE','FACET','FAITH','FANCY','FEAST','FENCE','FETCH','FEVER','FIELD','FIFTH',
  'FIFTY','FIGHT','FINAL','FIRST','FIXED','FLAME','FLAIR','FLARE','FLASH','FLASK',
  'FLOCK','FLOOD','FLOOR','FLOUR','FLUID','FLUNK','FOCUS','FORCE','FORGE','FORTH',
  'FORUM','FOUND','FRAME','FRESH','FRISK','FRONT','FROST','FROWN','FROZE','FULLY',
  'FUNNY','FUZZY',
  'GAUGE','GHOST','GIANT','GIVEN','GLAND','GLARE','GLAZE','GLEAM','GLIDE','GLOOM',
  'GLOSS','GLOVE','GOING','GRACE','GRADE','GRAIN','GRAND','GRANT','GRAPE','GRASP',
  'GRASS','GREED','GREET','GRILL','GROAN','GROOM','GROUP','GROVE','GROWL','GRUEL',
  'GRUFF','GUARD','GUESS','GUEST','GUIDE','GUILE','GUILT','GUISE','GUSTO',
  'HASTY','HAVEN','HAZARD','HEART','HEAVY','HEDGE','HINGE','HOARY','HOIST','HOMER',
  'HONEY','HONOR','HORNY','HORSE','HOTEL','HOVER','HUMAN','HUMID','HUMOR','HURRY',
  'IMAGE','IMPLY','INBOX','INDEX','INNER','INPUT','INTER','INTRO',
  'JUDGE','JUICY','JUMPY','JUNTA',
  'KAYAK','KNACK','KNEEL','KNIFE','KNOCK','KNOLL','KNOWS',
  'LABEL','LARGE','LASER','LATER','LAUGH','LEARN','LEAVE','LEGAL','LEVEL','LIGHT',
  'LIMIT','LINER','LOCAL','LODGE','LOGIC','LOOSE','LOWER','LUCKY','LYMPH',
  'MAGIC','MAJOR','MAKER','MANOR','MATCH','MEDIA','MIGHT','MINOR','MINUS','MIRTH',
  'MIXED','MONEY','MONTH','MOSSY','MOTIF','MOUNT','MOUTH','MOVIE','MUSTY','MYRRH',
  'NAIVE','NAVEL','NERVE','NEVER','NIGHT','NOBLE','NOISE','NORTH','NOTED','NOVEL',
  'NURSE',
  'OCCUR','OCEAN','OFFER','OFTEN','OMEGA','ONSET','OZONE',
  'PADDY','PAINT','PAIRS','PANEL','PANIC','PAPER','PARTY','PATCH','PAUSE','PEACE',
  'PEACH','PEARL','PEDAL','PENNY','PERCH','PHASE','PIANO','PLAID','PLAIN','PLANK',
  'PLANT','PLATE','PLAZA','PLEAD','PLEAT','PLUCK','PORCH','POSED','POUND','POWER',
  'PRESS','PRICE','PRIDE','PRINT','PRIZE','PROBE','PROOF','PROSE','PROUD','PROVE',
  'QUEEN','QUERY','QUEUE','QUICK','QUIET','QUIRK','QUOTA','QUITE',
  'RADAR','RADIO','RAINY','RAISE','RALLY','RANGE','RAPID','REACH','READY','REALM',
  'REALM','REBEL','REFER','REIGN','RELAX','REMIX','REPAY','RIDER','RIDGE','RIGHT',
  'RISEN','RISKY','RIVAL','RIVER','ROBOT','ROMAN','ROUGH','ROUND','ROUTE','ROVER',
  'ROYAL','RUGBY','RULER','RUSTY',
  'SAUCE','SCALE','SCARY','SCENE','SCORE','SCRAM','SCREW','SEDGE','SEIZE','SENSE',
  'SERVE','SEVEN','SHADE','SHAKE','SHALL','SHAME','SHAPE','SHARE','SHARP','SHEEN',
  'SHEEP','SHEER','SHELF','SHELL','SHIFT','SHONE','SHORE','SHORT','SHOUT','SIGHT',
  'SINCE','SIXTY','SIXTH','SIZED','SKILL','SLING','SLOPE','SMART','SMASH','SMELL',
  'SMILE','SMOKE','SNAIL','SNAKE','SNEAK','SNORE','SOLVE','SORRY','SOUTH','SPACE',
  'SPARE','SPARK','SPAWN','SPEAK','SPEND','SPILL','SPINE','SPITE','SPREE','STALL',
  'STAMP','STAND','STANK','STARK','START','STASH','STATE','STEAK','STEAL','STEAM',
  'STEEL','STEEP','STEER','STERN','STICK','STIFF','STILL','STING','STINK','STOCK',
  'STOMP','STONE','STOOD','STORE','STORK','STORM','STORY','STOVE','STRAW','STRIP',
  'STUCK','STUDY','STYLE','SUGAR','SUITE','SUNNY','SUPER','SWAMP','SWEAR','SWEAT',
  'SWEET','SWEPT','SWIFT','SWORE','SWORN',
  'TABLE','TASTE','TEACH','TEETH','THEFT','THEIR','THERE','THESE','THICK','THING',
  'THINK','THOSE','THREE','THREW','THROW','THUMB','TIDAL','TIGER','TIGHT','TIRED',
  'TITAN','TOAST','TODAY','TOKEN','TOPIC','TOTAL','TOUCH','TOUGH','TOWER','TOWEL',
  'TRADE','TRAIL','TRAIN','TRAIT','TRAMP','TRASH','TREAT','TREND','TRIAL','TRIBE',
  'TRIED','TROOP','TROUT','TRUCK','TRULY','TRUMP','TRUNK','TRUST','TRUTH','TUMBLE',
  'TUNER','TWIRL','TWIST','TYING',
  'ULCER','UNCLE','UNDER','UNIFY','UNITE','UNTIL','UPPER','UPSET','URINE','USHER',
  'VALID','VALUE','VALVE','VAPOR','VAULT','VERSE','VIOLA','VIGOR','VIRAL','VISIT',
  'VISTA','VITAL','VIVID','VOCAL','VODKA','VOMIT',
  'WATCH','WATER','WEARY','WEDGE','WEIGH','WEIRD','WHALE','WHEAT','WHEEL','WHERE',
  'WHICH','WHILE','WHIRL','WHITE','WHOLE','WHOSE','WIDER','WITCH','WOMAN','WRATH',
  'WRING','WROTE',
  'YACHT','YEARN','YOUNG','YOURS',
  'ZEBRA',
  // 6-letter
  'ABROAD','ACCENT','ACCESS','ACCUSE','ACROSS','ACTING','ACTION','ACTUAL','ADVICE',
  'AFFECT','AFFORD','AFRAID','AGREED','ALLEGE','ALMOST','AMOUNT','ANIMAL','ANSWER',
  'APPEAL','AROUND','ATTACK','AUTHOR','BATTLE','BEAUTY','BECOME','BEFORE','BEHALF',
  'BEHIND','BELIEF','BIGGER','BOUNCE','BREACH','BRIDGE','BRIGHT','BROKEN','BUDGET',
  'CALLED','CAMERA','CAREER','CHANGE','CHARGE','CHOOSE','CHOSEN','CHURCH','CIRCLE',
  'CLIENT','CLEVER','CLOSER','COMMON','DANGER','DECENT','DECIDE','DEEPLY','DEGREE',
  'DEMAND','DESIGN','DETAIL','DIRECT','DOMAIN','DOUBLE','DURING','EFFECT','EFFORT',
  'EITHER','EMPLOY','ENABLE','ENERGY','ENGAGE','ENOUGH','ENTIRE','ESCAPE','EVOLVE',
  'EXCEPT','EXPECT','EXPERT','EXTENT','FACTOR','FAILED','FAIRLY','FAMILY','FAMOUS',
  'FATHER','FIGURE','FINGER','FINISH','FLIGHT','FOLLOW','FORCED','FORMAL','FOSTER',
  'FRIEND','FUTURE','GATHER','GENDER','GENTLE','GROUND','GROWTH','HAPPEN','HEALTH',
  'HIGHER','IMPACT','INDEED','INSIDE','INVITE','ISLAND','ITSELF','JERSEY','JOINED',
  'JUNIOR','KILLED','LAUNCH','LEADER','LEARN','LENGTH','LETTER','LITTLE','LIVING',
  'LONGER','MAINLY','MANNER','MARKET','MASTER','MATTER','MEMBER','METHOD','MIDDLE',
  'MIRROR','MODERN','MOMENT','MOTHER','MURDER','NEARLY','NEEDED','NORMAL','NUMBER',
  'OBJECT','OFFICE','OFFICER','OFTEN','ONLINE','OPTION','ORANGE','OTHERS','OUTSET',
  'PARENT','PEOPLE','PERIOD','PERSON','PLACES','PLANET','PLAYER','PLEASE','PLEDGE',
  'PLENTY','POLICE','POLICY','PREFER','PRETTY','PRINCE','PRISON','PROFIT','PROPER',
  'PROVEN','PUBLIC','RATHER','REALLY','REASON','RECENT','RECORD','REGARD','RELIEF',
  'REMAIN','REPEAT','RESCUE','RETURN','REVEAL','REVIEW','REWARD','RIVERS','SAFETY',
  'SAMPLE','SAYING','SCHEME','SECOND','SECRET','SIMPLE','SINGLE','SISTER','SKILLS',
  'SMOOTH','SOURCE','SPRING','STRONG','SUPPLY','SYSTEM','USEFUL','VALLEY','VICTIM',
  'VISION','WINTER','WISDOM','WONDER','WITHIN','WORTHY',
]);

// ── Scoring table ─────────────────────────────────────────────────────────────
function scoreWord(word) {
  const len = word.length;
  if (len < 3) return 0;
  if (len <= 4) return 1;
  if (len === 5) return 2;
  if (len === 6) return 3;
  if (len === 7) return 5;
  return 11;
}

// ── Board generation ─────────────────────────────────────────────────────────
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function generateBoard() {
  const dice = shuffle(DICE.slice());
  // Roll each die
  return dice.map(faces => faces[Math.floor(Math.random() * faces.length)]);
  // Returns flat array of 16 letters (Q represents QU)
}

// ── Path finding (adjacency on 4×4 grid) ─────────────────────────────────────
function adjacent(i, j) {
  const r1 = Math.floor(i / 4), c1 = i % 4;
  const r2 = Math.floor(j / 4), c2 = j % 4;
  return Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1 && i !== j;
}

/** DFS: can `word` be formed on `board` starting at `startIdx`? */
function dfsPath(board, word, idx, pos, used) {
  if (idx === word.length) return true;
  for (let next = 0; next < 16; next++) {
    if (used[next]) continue;
    if (!adjacent(pos, next)) continue;
    const tile = board[next] === 'Q' ? 'QU' : board[next];
    if (word.slice(idx).startsWith(tile)) {
      used[next] = true;
      if (dfsPath(board, word, idx + tile.length, next, used)) return true;
      used[next] = false;
    }
  }
  return false;
}

function canFormWord(board, word) {
  for (let start = 0; start < 16; start++) {
    const tile = board[start] === 'Q' ? 'QU' : board[start];
    if (word.startsWith(tile)) {
      const used = new Array(16).fill(false);
      used[start] = true;
      if (dfsPath(board, word, tile.length, start, used)) return true;
    }
  }
  return false;
}

// ── Round timer (180 seconds) ─────────────────────────────────────────────────
const ROUND_SECONDS = 180;

function createGame(playerCount = 2) {
  if (playerCount < 2 || playerCount > 4) throw new Error('Boggle requires 2–4 players');

  const board = generateBoard();
  const startTime = Date.now();

  // submissions[seat] = Set of words submitted
  const submissions = Array.from({ length: playerCount }, () => new Set());

  let _isGameOver = false;
  let _scores = null;  // computed on endRound()
  let _words  = null;  // { seat: [{ word, score, unique }] }

  function timeLeft() {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    return Math.max(0, ROUND_SECONDS - elapsed);
  }

  function state() {
    return {
      gameType: 'boggle',
      board,                          // flat 16-char array
      timeLeft: timeLeft(),
      startTime,
      roundSeconds: ROUND_SECONDS,
      // During the round, only show each seat's own word count (keep submissions secret)
      submissionCounts: submissions.map(s => s.size),
      isGameOver: _isGameOver,
      scores: _scores,
      words: _words,
      playerCount,
    };
  }

  function submitWord(seat, word) {
    if (_isGameOver) return { ok: false, reason: 'Round is over' };
    if (timeLeft() <= 0) return { ok: false, reason: 'Time is up' };
    if (typeof word !== 'string') return { ok: false, reason: 'Invalid word' };

    const w = word.toUpperCase().trim();
    if (w.length < 3) return { ok: false, reason: 'Words must be at least 3 letters' };
    if (!/^[A-Z]+$/.test(w)) return { ok: false, reason: 'Letters only' };
    if (submissions[seat].has(w)) return { ok: false, reason: 'Already submitted' };
    if (!WORD_SET.has(w)) return { ok: false, reason: 'Not a valid word' };
    if (!canFormWord(board, w)) return { ok: false, reason: 'Cannot be formed on the board' };

    submissions[seat].add(w);
    return { ok: true, word: w };
  }

  function endRound() {
    if (_isGameOver) return { scores: _scores, words: _words };
    _isGameOver = true;

    // Find words submitted by exactly one player (unique = scores)
    // Words submitted by >1 player = cancelled
    const allWords = new Map(); // word → [seats]
    for (let s = 0; s < playerCount; s++) {
      for (const w of submissions[s]) {
        if (!allWords.has(w)) allWords.set(w, []);
        allWords.get(w).push(s);
      }
    }

    _scores = new Array(playerCount).fill(0);
    _words  = Array.from({ length: playerCount }, () => []);

    for (const [w, seats] of allWords) {
      const unique = seats.length === 1;
      const pts = unique ? scoreWord(w) : 0;
      for (const s of seats) {
        _scores[s] += pts;
        _words[s].push({ word: w, score: pts, unique });
      }
    }

    // Sort each player's word list: unique first, then alpha
    for (let s = 0; s < playerCount; s++) {
      _words[s].sort((a, b) => {
        if (a.unique !== b.unique) return b.unique - a.unique;
        return a.word.localeCompare(b.word);
      });
    }

    return { scores: _scores, words: _words };
  }

  function isGameOver() { return _isGameOver; }

  function winner() {
    if (!_scores) return null;
    let best = -1, bestSeat = null;
    for (let s = 0; s < playerCount; s++) {
      if (_scores[s] > best) { best = _scores[s]; bestSeat = s; }
    }
    return bestSeat;
  }

  return { state, submitWord, endRound, isGameOver, winner, timeLeft };
}

module.exports = { createGame };
