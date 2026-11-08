# אפיון מערכת – Alpha Order Tracker

> גרסת אפיון: 1.7 · עודכן: 2026-11-08 · מצב: באוויר (commit `460b57b` ב-`main`). מסך כניסה, ניהול משתמשים, מילוי מזמין אוטומטי, מחיקת הזמנות, Rules נעולים, תיקון "אין הרשאה" אחרי החלפת סיסמה ראשונה. 1.7: אוטומציית מייל שבועי. חלון ההגדרות באוויר, והקמת הסקריפט וה-Flow בתהליך

## 1. מטרה

מערכת Web לניהול ומעקב אחר דרישות רכש והזמנות ציוד של הצוות, מרגע פתיחת הדרישה ועד אימות קבלת הציוד וסגירתה. כל חברי הצוות רואים את אותם הנתונים בזמן אמת.

## 2. משתמשים והרשאות

| תפקיד | מה מותר | איך נוצר |
|---|---|---|
| **מנהל** (`yairz`) | כל מה שמשתמש רגיל יכול, וגם ניהול משתמשים: יצירה, חסימה, הפעלה מחדש וחיוב החלפת סיסמה | מוגדר לפי UID בקוד (`ADMIN_UIDS`) ובכללי האבטחה |
| **משתמש מורשה** | צפייה, הוספה, עריכה, שינוי סטטוס, ארכוב, מחיקה וייצוא לאקסל. שינוי הסיסמה של עצמו | המנהל יוצר אותו ממסך "ניהול משתמשים" |
| **משתמש חסום / לא ברשימה** | רואה רק מסך "אין הרשאת גישה" | — |
| **אורח (לא מחובר)** | רואה רק את מסך הכניסה | — |

- כל המשתמשים המורשים שווים בהרשאות על ההזמנות (אושר ע"י יאיר, 2026-11-05).
- היקף צפוי: עד כ-10 משתמשים.
- **אין הרשמה עצמית מהממשק.** רק המנהל יוצר משתמשים.

### מחזור חיים של משתמש
1. **יצירה:** המנהל מקליד **שם מלא** (למשל "משה כהן"), שם משתמש וסיסמה זמנית (נוצרת אוטומטית, אפשר לשנות) ← "צור משתמש". את השם המלא אפשר לערוך אחר כך מהרשימה (אייקון עיפרון). רק המנהל יכול לערוך שמות.
2. המנהל מעביר לעובד את שם המשתמש ואת הסיסמה הזמנית **בערוץ פרטי**.
3. **כניסה ראשונה:** העובד נכנס עם הסיסמה הזמנית, ו**חייב** לבחור סיסמה אישית (לפחות 8 תווים) לפני שהוא רואה נתונים.
4. **שימוש שוטף.** כל משתמש יכול לשנות סיסמה בלחיצה על שם המשתמש שלו בכותרת.
5. **חסימה:** המנהל לוחץ "חסום", והגישה נחסמת מיד (גם אם העובד מחובר כרגע). "הפעל מחדש" מחזיר את הגישה.
6. **שכח סיסמה:** המנהל מאפס לו סיסמה ב-Firebase Console (Authentication ← Users ← ⋮ ← Reset password), ואז לוחץ באתר "חייב החלפת סיסמה".

## 3. ארכיטקטורה

| רכיב | טכנולוגיה |
|---|---|
| ממשק | קובץ `index.html` יחיד, React 18 שמתקמפל בדפדפן דרך Babel, ללא Build Step |
| עיצוב | Tailwind CSS (CDN), תמיכה מלאה ב-RTL |
| מסד נתונים | Firebase Firestore: קולקציות `orders` ו-`users` |
| הזדהות | Firebase Authentication, שיטת Email/Password |
| ייצוא | `xlsx-js-style` 1.2.0 |
| גיבוי מקומי | `localStorage` (מפתח `company_orders_data`) כשאין חיבור לענן |
| אחסון קוד ואתר | GitHub `yairzz/Alpha-order-tracker` (ציבורי), מוגש ב-GitHub Pages: `https://yairzz.github.io/Alpha-order-tracker/` |

### זרימת טעינה
1. הדף נטען ומאתחל את Firebase.
2. `AuthGate` בודק אם יש משתמש מחובר.
   - לא מחובר: מוצג `LoginScreen`.
   - מחובר: נטענת הרשומה שלו מ-`users/{uid}`, במעקב חי.
3. לפי הרשומה:
   - אין רשומה, או `active: false`: מוצג `AccessDeniedScreen`. **המנהל חריג:** בכניסה הראשונה שלו הרשומה שלו נוצרת אוטומטית.
   - `mustChangePassword: true`: מוצג מסך החלפת סיסמה, בלי גישה לנתונים.
   - אחרת: נטען `OrderTracker`.
4. ההתחברות נשמרת בדפדפן. כפתור "התנתק" מוציא את המשתמש מהמערכת.
5. **סנכרון עם השרת:** `AuthGate` מתעלם משינויים מקומיים ברשומת המשתמש שעוד לא נשמרו בשרת (`hasPendingWrites`). לכן אחרי החלפת סיסמה ה-`OrderTracker` נפתח רק אחרי שהשרת אישר `mustChangePassword: false`.
6. **ניסיון חוזר:** אם קריאת ההזמנות נכשלת ב-`permission-denied`, ה-`OrderTracker` מנסה שוב עד 3 פעמים (אחרי 1.5, 3 ו-4.5 שניות). רק אחרי זה מוצגת הודעת "אין הרשאה".

### שם משתמש ← אימייל
Firebase מזהה משתמשים לפי אימייל. המערכת מוסיפה לשם המשתמש סיומת קבועה:
`yairz` ← `yairz@alpha-order-tracker.firebaseapp.com` (הקבוע `USERNAME_EMAIL_DOMAIN`).
זו כתובת מזהה בלבד, בלי תיבת דואר מאחוריה, ולכן אי אפשר לשלוח מייל איפוס סיסמה.
שם משתמש תקין: 2–30 תווים: אותיות באנגלית קטנות, ספרות, `.`, `-`, `_`.

### יצירת משתמש מהדפדפן
המנהל יוצר משתמשים דרך **מופע Firebase משני** (`user-admin`), כדי שהיצירה לא תנתק את המנהל עצמו. זה מחייב שב-Firebase ההגדרה **"Enable create (sign-up)" תישאר פעילה**. לכן כל אחד יכול טכנית ליצור חשבון Auth, אבל **חשבון בלי רשומה ב-`users` לא מקבל גישה לשום נתון.** את זה אוכפים כללי האבטחה (סעיף 7).

## 4. מודל נתונים

### `orders/{orderId}`
| שדה | סוג | חובה | תיאור |
|---|---|---|---|
| `itemName` | string | ✔ | שם הפריט |
| `requestedBy` | string | | מזמין (שדות ישנים: `orderer`, `ordererName`) |
| `orderNumber` | string | | מספר הזמנה (PO) |
| `trackingNumber` | string | | מספר מעקב משלוח |
| `quantity` | number | ✔ | כמות, ברירת מחדל 1 |
| `project` | string | | שם פרויקט |
| `url` | string | | קישור למוצר או להזמנה |
| `status` | string | ✔ | אחד מערכי הסטטוס (סעיף 5) |
| `notes` | string | | הערות |
| `isArchived` | boolean | ✔ | האם ההזמנה בארכיון |
| `date` | ISO string | ✔ | תאריך יצירה להצגה |
| `createdAt` | number (ms) | ✔ | חותמת זמן למיון |

### `users/{uid}` – רשימת המורשים
| שדה | סוג | תיאור |
|---|---|---|
| `username` | string | שם המשתמש (בלי הסיומת) |
| `displayName` | string | שם מלא בעברית. ממולא אוטומטית בשדה "מזמין" בהזמנה חדשה |
| `role` | `'admin'` \| `'user'` | תפקיד. בפועל ההרשאה נקבעת לפי UID בכללים, והשדה הזה לתצוגה בלבד |
| `active` | boolean | `false` = חסום |
| `mustChangePassword` | boolean | `true` = חייב לבחור סיסמה חדשה בכניסה הבאה |
| `createdAt` | number (ms) | מועד יצירה |
| `createdBy` | string | UID של המנהל שיצר |
| `passwordChangedAt` | number (ms) | מועד החלפת הסיסמה האחרונה |

**סיסמאות לא נשמרות במסד הנתונים.** הן נשמרות רק ב-Firebase Authentication, מוצפנות.

### `settings/automation` – הגדרות המייל השבועי (מנהל בלבד)
| שדה | סוג | תיאור |
|---|---|---|
| `enabled` | boolean | האם האוטומציה פעילה |
| `recipientEmail` | string | נמען או נמענים, מופרדים בפסיק |
| `ccEmail` | string | העתק (CC), לא חובה |
| `replyTo` | string | כתובת לתשובות, לא חובה. משמשת רק הכתובת הראשונה, ורק בשליחה ישירה מ-Gmail |
| `relayEmail` | string | תיבת ממסר ב-Outlook. אם השדה מלא, המייל יוצא דרך Power Automate מחשבון ה-Outlook (ראה סעיף 7א) |
| `minItems` | number | שולחים כשיש **לפחות** כמה פריטים בסטטוס `ראשוני`. ברירת מחדל: 2 |
| `subject`, `body` | string | נושא ונוסח המייל. אפשר לשלב בהם `{כמות}` (מספר הפריטים) ו-`{תאריך}` (תאריך השליחה) |
| `updatedAt`, `updatedBy` | number, string | מועד העדכון האחרון באתר, וה-UID של מי שעדכן |
| `lastRun` | map | נכתב על ידי הסקריפט: `at`, `result` (`sent` / `below-threshold` / `disabled` / `no-recipient` / `test` / `error`), `itemCount`, `message` |

## 5. תהליך עבודה – סטטוסים

`ראשוני` ← `נשלחה לשגיא` ← `נשלחה למחלקת רכש` ← `אושרה ע"י אלירן` ← `הוזמנה` ← `התקבלה במחלקת רכש` ← `נמסרה` ← `אומתה ונסגרה`

סטטוסי חריגה: `הגיע שגוי/תקול`, `התקבל חלקית`, `הוזמן מחדש`.
"בתהליך עבודה" בדשבורד = כל הזמנה פעילה שעדיין לא במצב `אומתה ונסגרה`.

## 6. יכולות

1. **מסך כניסה:** שם משתמש וסיסמה, הודעות שגיאה בעברית, הגנה מפני ניסיונות חוזרים (מנגנון מובנה של Firebase).
2. **החלפת סיסמה:** חובה בכניסה הראשונה, ואפשרית בכל זמן (לחיצה על שם המשתמש בכותרת). דורשת את הסיסמה הנוכחית.
3. **ניהול משתמשים (מנהל בלבד):** יצירה עם שם מלא וסיסמה זמנית והעתקת הפרטים, עריכת שם מלא, רשימת משתמשים עם מצב (פעיל / ממתין להחלפת סיסמה / חסום), חסימה, הפעלה מחדש, חיוב החלפת סיסמה.
4. **דשבורד:** ארבעה מדדים: סה"כ פעילות, בתהליך, אומתו ונסגרו, בארכיון.
5. **חיפוש וסינון:** חיפוש חופשי (פריט, מזמין, מספר הזמנה, פרויקט, הערות) וסינון לפי פרויקט.
6. **טבלה:** מיון לפי עמודה, בחירה מרובה, שינוי סטטוס ישירות מהטבלה, חלונות מהירים להערות ולמספר מעקב.
7. **הוספה ועריכה:** טופס עם השלמה אוטומטית לפרויקט ולמזמין.
   - **מזמין אוטומטי:** בהזמנה **חדשה**, שדה "מזמין" ממולא מראש בשם המלא (`displayName`) של המשתמש המחובר. השדה נשאר ניתן לעריכה, למקרה שעובד מזמין עבור עובד אחר. אם למשתמש אין שם מלא, השדה נשאר ריק.
   - בעריכת הזמנה **קיימת** המזמין לא משתנה.
8. **ארכיון:** העברה לארכיון ושחזור ממנו.
9. **מחיקה:** כפתור פח בעמודת הפעולות (גם בהזמנות פעילות וגם בארכיון). לפני המחיקה מוצגת בקשת אישור עם שם הפריט. המחיקה סופית.
10. **ייצוא לאקסל:** קובץ RTL מעוצב.
    **כלל קשיח:** בדיוק 5 עמודות: `שם הפריט`, `כמות`, `פרויקט`, `קישור`, `הערות`. **בלי** עמודת מזמין.
11. **הגדרת Firebase חלופי:** אפשר להדביק קונפיגורציה אחרת (נשמרת ב-`localStorage`).
12. **אוטומציה, מייל אוטומטי בימי ראשון ורביעי (מנהל בלבד):** צבע הכפתור "אוטומציה" משקף את מצב המתג, ומתעדכן בזמן אמת: **ירוק** = פעילה, **אדום חלש** = כבויה, לבן = המצב לא נטען. כפתור "אוטומציה" בכותרת פותח חלון הגדרות שנשמר ב-`settings/automation`. אפשר להגדיר בו הפעלה או כיבוי, נמען, CC, Reply-To, סף, ונושא ונוסח שאפשר לערוך. החלון מציג גם את תוצאת הריצה האחרונה. פירוט בסעיף 7א.

## 7א. אוטומציה – מייל שבועי

**מה היא עושה:** בכל יום **ראשון ורביעי**, בין 08:00 ל-09:00 שעון ישראל. הימים מוגדרים בקבוע `RUN_DAYS` בסקריפט. אחרי שינוי שלו צריך להריץ שוב את `installWeeklyTrigger`:
1. קוראת את ההגדרות. אם האוטומציה כבויה או שלא הוגדר נמען, היא לא שולחת כלום.
2. סופרת את ההזמנות בסטטוס `ראשוני` שאינן בארכיון.
3. אם יש לפחות `minItems` הזמנות כאלה:
   - שולחת מייל עם קובץ אקסל באותן 5 עמודות כמו הייצוא מהאתר (בלי מזמין).
   - מעבירה את ההזמנות האלה לסטטוס `נשלחה לשגיא`.
4. כותבת את התוצאה ב-`lastRun`.

**איפה היא רצה:** Google Apps Script בחשבון ה-Gmail שבו נוצר פרויקט ה-Firebase.
- **הנבחר: דרך ג'.** המייל לנמענים יוצא מ-**Outlook** דרך Power Automate (ראה "שליחה מ-Outlook" למטה).
- בלי תיבת ממסר, המייל יוצא ישירות מ-Gmail, עם Reply-To.
- הסקריפט פונה ל-Firestore עם ההרשאה של בעל הפרויקט. **אין מפתחות או סיסמאות**, וגם לא נשמר שום סוד.
- גישה כזו עוקפת את ה-Rules, כמו גישה מה-Console.
- הקוד שמור בריפו לתיעוד: `automation/weekly-email.gs` ו-`automation/appsscript.json`. **העותק שרץ בפועל** נמצא ב-script.google.com.
- **שינוי בקוד בריפו לא משפיע על הריצה** עד שמדביקים אותו מחדש ב-Apps Script.

**הקמה (חד-פעמית):**
1. ב-script.google.com, מחובר לחשבון ה-Gmail הנכון: New project. שם: `Alpha order tracker – weekly email`.
2. Project Settings ← לסמן "Show appsscript.json manifest file in editor".
3. להדביק את תוכן `appsscript.json` ואת `weekly-email.gs` (במקום `Code.gs`) ← Save.
4. להריץ `createRelayToken` ← לאשר את ההרשאות. מופיעה האזהרה "Google hasn't verified this app", כי זה סקריפט פרטי: Advanced ← Go to … ← Allow. ביומן (Execution log) מופיע הקוד הסודי. להעתיק אותו לתהליך ב-Power Automate בלבד.
5. להקים את התהליך ב-Power Automate (ראה למטה).
6. באתר, אוטומציה: תיבת ממסר = כתובת ה-Outlook ← שמור (המתג "פעילה" עדיין כבוי).
7. להריץ `testSendToMe`. אמור להגיע ל-Outlook מייל "[בדיקה] …" נקי עם אקסל, שנשלח מ-Outlook עצמו.
8. להריץ `installWeeklyTrigger` (פעם אחת). לבדוק ב-Triggers (סמל שעון) שמופיעות **שתי** שורות של `weeklyCheck` מסוג Week timer: Sunday ו-Wednesday.
9. באתר: נמען = שגיא, CC לפי הצורך, לסמן "האוטומציה פעילה" ← שמור.

### שליחה מ-Outlook דרך Power Automate (ממסר)
**הזרימה:**
1. Apps Script שולח מ-Gmail **רק** לתיבת הממסר (ה-Outlook של יאיר). הנושא בנוי כך:
   `[AOT-RELAY] <הנושא> ||to=<נמענים מופרדים ב-;>||cc=<העתק>||key=<קוד סודי>`
   הנוסח בגוף המייל עטוף בסמנים `[[AOT-START]]` ו-`[[AOT-END]]`, ושורות חדשות מומרות ל-`<br>`.
2. תהליך ב-Power Automate מזהה את המייל ובודק שני דברים: שהשולח הוא כתובת ה-Gmail, ושהקוד נכון.
3. אם הבדיקות עוברות, התהליך שולח **מייל חדש** מה-Outlook לנמענים, עם הנושא הנקי, הנוסח והאקסל.

**אבטחה:**
- בלי שתי הבדיקות, כל אחד יכול היה לשלוח ליאיר מייל עם נושא מתאים ולגרום ל-Outlook שלו לשלוח מיילים בשמו.
- הקוד הסודי (`RELAY_TOKEN`) נוצר ב-Apps Script עם `createRelayToken()` ונשמר רק ב-Script Properties ובתהליך ב-Power Automate. **אסור לשמור אותו בריפו.**

**הקמת התהליך** ב-make.powerautomate.com, עם חשבון העבודה:
1. Create ← **Automated cloud flow**. שם: `AOT weekly relay`. טריגר: **When a new email arrives (V3)** (Office 365 Outlook).
2. הגדרות הטריגר (Show all):
   - Folder: `Inbox`
   - From: כתובת ה-Gmail
   - Subject Filter: `[AOT-RELAY]`
   - Include Attachments: `Yes`
3. **Condition:** בצד שמאל, ביטוי (Expression):
   `first(split(last(split(triggerOutputs()?['body/subject'], '||key=')), '||'))`
   התנאי: `is equal to` ← הקוד הסודי.
4. בענף **If yes**:
   - **Select** (Data Operation):
     - From: `triggerOutputs()?['body/attachments']`
     - Map (במצב טקסט): `{"Name": "@{item()?['name']}", "ContentBytes": "@{item()?['contentBytes']}"}`
   - **Send an email (V2)**:
     - To: `first(split(last(split(triggerOutputs()?['body/subject'], '||to=')), '||'))`
     - Subject: `trim(replace(first(split(triggerOutputs()?['body/subject'], '||')), '[AOT-RELAY]', ''))`
     - Body: ביטוי ששומר רק את הטקסט שבין הסמנים `[[AOT-START]]` ו-`[[AOT-END]]`. כך לא עוברות לשגיא הודעות ש-Outlook מוסיף למיילים נכנסים (למשל "You don't often get email from…"):
       `concat('<div dir="rtl" style="font-family:Arial,sans-serif;font-size:14px">', first(split(last(split(triggerOutputs()?['body/body'], '[[AOT-START]]')), '[[AOT-END]]')), '</div>')`
     - Advanced ← CC: `first(split(last(split(triggerOutputs()?['body/subject'], '||cc=')), '||'))`
     - Attachments: לעבור לקלט מערך (סמל `T` / Switch to input entire array) ← הפלט של `Select`.
   - (רשות) **Move email (V2)** של המייל המקורי לתיקייה `AOT` כדי לא להעמיס על תיבת הדואר.
5. Save.

**כיבוי:** לבטל את הסימון "האוטומציה פעילה" באתר. הסקריפט ימשיך לרוץ, אבל לא ישלח. כדי לעצור אותו לגמרי מריצים `removeWeeklyTrigger`.
**כשל:** Google שולח מייל שגיאה לבעל הסקריפט, והשגיאה מוצגת גם ב"ריצה אחרונה" באתר.

## 7. אבטחה

| שכבה | מה מגן | הערות |
|---|---|---|
| מסך כניסה ומסכי הרשאה | מסתירים את הממשק ממי שלא מורשה | **לבד הם לא מספיקים.** הקוד ציבורי, ואפשר לפנות ישירות למסד הנתונים |
| **Firestore Security Rules** | **ההגנה האמיתית על הנתונים** | רק משתמש פעיל ברשימת המורשים ניגש להזמנות. רק המנהל משנה את רשימת המורשים |
| `apiKey` ו-UID בקוד | — | אינם סודות. מותר שיופיעו בקוד ציבורי |

### מצב אבטחה (נכון ל-2026-11-05)
| נושא | מצב |
|---|---|
| Rules נעולים. קריאת `orders`/`users` ללא התחברות מחזירה 403 | ✅ נבדק |
| Email/Password מופעל, `yairzz.github.io` ב-Authorized domains | ✅ |
| 7 משתמשים נוצרו (מנהל + 6), כולם עם שם מלא | ✅ |
| GitHub: רק `yairzz` עם הרשאת כתיבה | ✅ |
| GitHub: Ruleset `protect-main` (חסימת מחיקה ו-force push) | ✅ |
| GitHub: Secret scanning + Push protection | ✅ |
| GitHub: **אימות דו-שלבי (2FA)** | ⏳ **פתוח.** יאיר יפעיל בהמשך |
| כניסה ראשונה של עובד רגיל **אחרי** נעילת ה-Rules | ✅ שי נכנס ב-2026-11-08. נמצאה ותוקנה בעיית תזמון אחרי החלפת הסיסמה (`460b57b`) |
| גיבוי קבוע של נתוני Firestore | ⏳ פתוח (רשות) |

### הגנה על הקוד ב-GitHub
- הריפו ציבורי: כולם יכולים **לקרוא**, ורק `yairzz` יכול **לשנות**.
- Ruleset `protect-main` על ענף ברירת המחדל: **Restrict deletions** + **Block force pushes**. **לא** מוגדרת חובת Pull Request, כדי לא לחסום עדכונים רגילים.
- Secret scanning + Push protection: GitHub חוסם העלאה של סודות לקוד. התראה על `apiKey` של Firebase היא התראת שווא מבחינתנו (המפתח לא סודי).

### Rules (Firestore ← Rules)
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn() { return request.auth != null; }

    function isAdmin() {
      return signedIn() && request.auth.uid in ['sMoVn9wwO9dZx2vMuQXf2AJRBNs2'];
    }

    function profile() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid)).data;
    }

    // Active user on the allowed list, who already chose a personal password
    function isMember() {
      return signedIn()
        && exists(/databases/$(database)/documents/users/$(request.auth.uid))
        && profile().active == true
        && profile().mustChangePassword != true;
    }

    match /orders/{orderId} {
      allow read, create, update, delete: if isAdmin() || isMember();
    }

    match /users/{uid} {
      allow read: if isAdmin() || (signedIn() && request.auth.uid == uid);
      allow create, delete: if isAdmin();
      // Admin can change anything. A user may only clear their own "must change password" flag.
      allow update: if isAdmin()
        || (signedIn() && request.auth.uid == uid
            && request.resource.data.diff(resource.data).affectedKeys()
                 .hasOnly(['mustChangePassword', 'passwordChangedAt'])
            && request.resource.data.mustChangePassword == false);
    }

    // Automation settings (weekly email): admin only. The Apps Script uses the
    // project owner's Google credentials, which are not subject to these rules.
    match /settings/{docId} {
      allow read, write: if isAdmin();
    }

    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

### הגדרה ב-Firebase Console
1. Authentication ← Sign-in method ← **Email/Password** ← Enable. (✅ בוצע 2026-11-05)
2. Authentication ← Users ← Add user: **רק המנהל**, `yairz@alpha-order-tracker.firebaseapp.com`. (✅ בוצע 2026-11-05)
3. Authentication ← Settings ← User actions: **"Enable create (sign-up)" נשאר פעיל.** זה נדרש כדי שהמנהל יוכל ליצור משתמשים מהאתר. ההגנה היא ה-Rules.
4. Authentication ← Settings ← Authorized domains: `yairzz.github.io` ו-`localhost`. (✅ נוסף 2026-11-05)
5. Firestore ← Rules ← להדביק את הכללים ← Publish. (✅ פורסם 2026-11-05, אחרי שהאתר החדש עלה ונבדק)

## 8. גיבוי ושחזור

- לפני כל שינוי קוד: תגית git בשם `backup-YYYY-MM-DD-<נושא>`, עבודה על ענף נפרד, והעתק של `index.html` לתיקייה `Alpha-order-tracker-backups` (מחוץ לריפו).
- שחזור קוד: `git checkout <tag> -- index.html`, או העתקה חזרה מתיקיית הגיבויים.
- גיבוי נתונים: ייצוא Firestore (Google Cloud ← Firestore ← Import/Export), או ייצוא לאקסל מהממשק (5 עמודות בלבד, ולכן זה לא גיבוי מלא). מומלץ להגדיר גיבוי נתונים קבוע, כי המחיקה סופית.

## 9. אילוצי פיתוח

- קובץ HTML יחיד, ללא Build Step.
- תמיכה מלאה ב-RTL וממשק בעברית.
- כל שינוי בייצוא לאקסל חייב לשמור על כלל 5 העמודות.
- סנכרון Firebase עם `localStorage` כגיבוי.
- אין לשמור סיסמאות, טוקנים או רשימות משתמשים בקוד, כי הריפו ציבורי.
