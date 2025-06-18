// /home/maixnor/repo/languagebuddy/backend/src/types/languages.ts

export interface Language {
    name: string;
    dialects: string[];
    welcome: string;
    "ask-dialect"?: string;
}

export const languages: Language[] = [
    {
        name: "Chinese",
        dialects: [
            "Mandarin (Putonghua)",
            "Cantonese (Yue)",
            "Shanghainese (Wu)",
            "Hokkien (Min Nan)",
            "Sichuanese",
            "Taiwanese Mandarin"
        ],
        welcome: "你好！我是你的语言伙伴，想帮助你学习一门新语言。请用你的母语给我发消息吧！",
        "ask-dialect": "很好，你说哪种方言？我会说普通话、粤语、吴语、闽南语、四川话和台湾普通话。"
    },
    {
        name: "English",
        dialects: [
            "American English",
            "British English",
            "Australian English",
            "Canadian English",
            "Indian English",
            "Irish English",
            "Scottish English",
            "South African English",
            "New Zealand English",
            "African American Vernacular English (AAVE)",
            "Singaporean English"
        ],
        welcome: "Hello! I'm your language buddy, here to help you learn a new language. Please message me in your native language!",
        "ask-dialect": "Great! Which variety of English do you speak? I can communicate in American, British, Australian, Canadian, Indian, Irish, Scottish, South African, New Zealand, AAVE, or Singaporean English."
    },
    {
        name: "Hindi",
        dialects: [
            "Standard Hindi",
            "Khari Boli",
            "Bambaiya Hindi",
            "Awadhi",
            "Braj"
        ],
        welcome: "नमस्ते! मैं आपका भाषा साथी हूं, एक नई भाषा सीखने में आपकी मदद करने के लिए यहां हूं। कृपया मुझे अपनी मातृभाषा में संदेश भेजें!",
        "ask-dialect": "बहुत अच्छा! आप कौन सी हिंदी बोली बोलते हैं? मैं मानक हिंदी, खड़ी बोली, बंबइया हिंदी, अवधी, या ब्रज में बात कर सकता हूं।"
    },
    {
        name: "Spanish",
        dialects: [
            "Castilian Spanish (Spain)",
            "Mexican Spanish",
            "Argentine Spanish (Rioplatense)",
            "Colombian Spanish",
            "Chilean Spanish",
            "Caribbean Spanish",
            "Andalusian Spanish",
            "Peruvian Spanish"
        ],
        welcome: "¡Hola! Soy tu compañero de idiomas, estoy aquí para ayudarte a aprender un nuevo idioma. ¡Por favor, envíame un mensaje en tu lengua materna!",
        "ask-dialect": "¡Excelente! ¿Qué variedad de español hablas? Puedo comunicarme en español castellano, mexicano, argentino (rioplatense), colombiano, chileno, caribeño, andaluz o peruano."
    },
    {
        name: "Arabic",
        dialects: [
            "Modern Standard Arabic",
            "Egyptian Arabic",
            "Levantine Arabic",
            "Gulf Arabic",
            "Maghrebi Arabic",
            "Iraqi Arabic",
            "Sudanese Arabic",
            "Yemeni Arabic"
        ],
        welcome: "مرحباً! أنا رفيقك اللغوي، هنا لمساعدتك على تعلم لغة جديدة. يرجى مراسلتي بلغتك الأم!",
        "ask-dialect": "رائع! أي لهجة عربية تتحدث؟ يمكنني التواصل بالعربية الفصحى، المصرية، الشامية، الخليجية، المغاربية، العراقية، السودانية أو اليمنية."
    },
    {
        name: "French",
        dialects: [
            "Parisian French",
            "Canadian French (Québécois)",
            "Belgian French",
            "Swiss French",
            "African French (West Africa)",
            "Acadian French"
        ],
        welcome: "Bonjour ! Je suis votre compagnon linguistique, ici pour vous aider à apprendre une nouvelle langue. Veuillez m'envoyer un message dans votre langue maternelle !",
        "ask-dialect": "Parfait ! Quelle variété de français parlez-vous ? Je peux communiquer en français parisien, québécois, belge, suisse, africain ou acadien."
    },
    {
        name: "Bengali",
        dialects: [
            "Standard Bengali",
            "Sylheti",
            "Chittagonian"
        ],
        welcome: "নমস্কার! আমি আপনার ভাষার সঙ্গী, একটি নতুন ভাষা শিখতে আপনাকে সাহায্য করার জন্য এখানে আছি। দয়া করে আমাকে আপনার মাতৃভাষায় বার্তা পাঠান!",
        "ask-dialect": "চমৎকার! আপনি কোন বাংলা উপভাষা বলেন? আমি মানক বাংলা, সিলেটি, বা চাটগাঁইয়া বাংলায় কথা বলতে পারি।"
    },
    {
        name: "Portuguese",
        dialects: [
            "European Portuguese",
            "Brazilian Portuguese",
            "Angolan Portuguese",
            "Mozambican Portuguese"
        ],
        welcome: "Olá! Sou o seu companheiro de idiomas, aqui para ajudá-lo a aprender uma nova língua. Por favor, envie-me uma mensagem no seu idioma nativo!",
        "ask-dialect": "Ótimo! Qual variedade de português você fala? Posso me comunicar em português europeu, brasileiro, angolano ou moçambicano."
    },
    {
        name: "Russian",
        dialects: [
            "Standard Russian",
            "Moscow Russian",
            "St. Petersburg Russian",
            "Ukrainian Russian"
        ],
        welcome: "Привет! Я ваш языковой помощник, готов помочь вам выучить новый язык. Пожалуйста, напишите мне на вашем родном языке!",
        "ask-dialect": "Отлично! Какой вариант русского языка вы используете? Я могу общаться на стандартном русском, московском, петербургском или украинском варианте русского."
    },
    {
        name: "Urdu",
        dialects: [
            "Standard Urdu",
            "Dakhini"
        ],
        welcome: "السلام علیکم! میں آپ کا زبان کا ساتھی ہوں، ایک نئی زبان سیکھنے میں آپ کی مدد کرنے کے لیے یہاں ہوں۔ براہ کرم مجھے اپنی مادری زبان میں پیغام بھیجیں!",
        "ask-dialect": "بہت خوب! آپ کون سی اردو بولتے ہیں؟ میں معیاری اردو یا دکنی اردو میں بات کر سکتا ہوں۔"
    },
    {
        name: "Indonesian",
        dialects: [
            "Standard Indonesian",
            "Javanese-influenced Indonesian"
        ],
        welcome: "Halo! Saya adalah teman bahasa Anda, di sini untuk membantu Anda belajar bahasa baru. Silakan kirim pesan kepada saya dalam bahasa ibu Anda!",
        "ask-dialect": "Bagus! Anda berbicara variasi Indonesia yang mana? Saya dapat berkomunikasi dalam bahasa Indonesia standar atau bahasa Indonesia yang dipengaruhi Jawa."
    },
    {
        name: "German",
        dialects: [
            "Standard German (Hochdeutsch)",
            "Austrian German",
            "Swiss German",
            "Bavarian",
            "Viennese (Wienerisch)",
            "Berlinerisch",
            "Swabian (Schwäbisch)"
        ],
        welcome: "Hallo! Ich bin dein Sprachpartner und helfe dir gerne beim Erlernen einer neuen Sprache. Bitte schreibe mir in deiner Muttersprache!",
        "ask-dialect": "Sehr gut! Welche Variante des Deutschen sprichst du? Ich kann in Hochdeutsch, österreichischem Deutsch, Schweizerdeutsch, Bayerisch, Wienerisch, Berlinerisch oder Schwäbisch kommunizieren."
    },
    {
        name: "Japanese",
        dialects: [
            "Standard Japanese (Tokyo)",
            "Kansai-ben",
            "Tohoku-ben",
            "Hakata-ben"
        ],
        welcome: "こんにちは！私はあなたの言語パートナーで、新しい言語を学ぶお手伝いをします。あなたの母国語でメッセージを送ってください！",
        "ask-dialect": "素晴らしい！どの日本語の方言を話されますか？標準語（東京弁）、関西弁、東北弁、博多弁でお話しできます。"
    },
    {
        name: "Swahili",
        dialects: [
            "Standard Swahili",
            "Kenyan Swahili",
            "Tanzanian Swahili"
        ],
        welcome: "Habari! Mimi ni rafiki wako wa lugha, niko hapa kukusaidia kujifunza lugha mpya. Tafadhali nitumie ujumbe kwa lugha yako ya asili!",
        "ask-dialect": "Vizuri sana! Unazungumza lahaja gani ya Kiswahili? Ninaweza kuwasiliana kwa Kiswahili sanifu, Kiswahili cha Kenya, au Kiswahili cha Tanzania."
    },
    {
        name: "Marathi",
        dialects: [
            "Standard Marathi",
            "Varhadi",
            "Malvani"
        ],
        welcome: "नमस्कार! मी तुमचा भाषा मित्र आहे, तुम्हाला नवीन भाषा शिकण्यासाठी मदत करण्यासाठी येथे आहे. कृपया मला तुमच्या मातृभाषेत संदेश पाठवा!",
        "ask-dialect": "छान! तुम्ही कोणती मराठी बोली बोलता? मी प्रमाण मराठी, वऱ्हाडी किंवा मालवणी मध्ये संवाद साधू शकतो."
    },
    {
        name: "Telugu",
        dialects: [
            "Standard Telugu",
            "Telangana Telugu"
        ],
        welcome: "నమస్కారం! నేను మీ భాషా స్నేహితుడిని, మీరు కొత్త భాషను నేర్చుకోవడానికి సహాయం చేయడానికి ఇక్కడ ఉన్నాను. దయచేసి మీ మాతృభాషలో నాకు సందేశం పంపండి!",
        "ask-dialect": "చాలా బాగుంది! మీరు ఏ తెలుగు మాట్లాడతారు? నేను ప్రామాణిక తెలుగు లేదా తెలంగాణ తెలుగులో సంభాషించగలను."
    },
    {
        name: "Turkish",
        dialects: [
            "Istanbul Turkish (Standard)",
            "Aegean Turkish",
            "Eastern Anatolian Turkish"
        ],
        welcome: "Merhaba! Ben dil arkadaşınızım, yeni bir dil öğrenmenize yardımcı olmak için buradayım. Lütfen bana ana dilinizde mesaj gönderin!",
        "ask-dialect": "Harika! Hangi Türkçe lehçesini konuşuyorsunuz? İstanbul Türkçesi (standart), Ege Türkçesi veya Doğu Anadolu Türkçesi ile iletişim kurabilirim."
    },
    {
        name: "Vietnamese",
        dialects: [
            "Northern Vietnamese",
            "Southern Vietnamese",
            "Central Vietnamese"
        ],
        welcome: "Xin chào! Tôi là người bạn ngôn ngữ của bạn, ở đây để giúp bạn học một ngôn ngữ mới. Vui lòng gửi tin nhắn cho tôi bằng tiếng mẹ đẻ của bạn!",
        "ask-dialect": "Tuyệt vời! Bạn nói giọng Việt nào? Tôi có thể giao tiếp bằng tiếng Việt Bắc, tiếng Việt Nam hoặc tiếng Việt Trung."
    },
    {
        name: "Korean",
        dialects: [
            "Seoul Korean (Standard)",
            "Busan Korean",
            "Jeju Korean"
        ],
        welcome: "안녕하세요! 저는 당신의 언어 친구로, 새로운 언어를 배우는 데 도움을 드리기 위해 여기 있습니다. 모국어로 메시지를 보내주세요!",
        "ask-dialect": "좋습니다! 어떤 한국어 방언을 사용하시나요? 서울말(표준어), 부산 사투리, 제주 사투리로 대화할 수 있습니다."
    },
    {
        name: "Italian",
        dialects: [
            "Standard Italian",
            "Sicilian",
            "Neapolitan",
            "Romanesco",
            "Venetian",
            "Sardinian"
        ],
        welcome: "Ciao! Sono il tuo compagno di lingua, qui per aiutarti a imparare una nuova lingua. Per favore, mandami un messaggio nella tua lingua madre!",
        "ask-dialect": "Ottimo! Quale varietà di italiano parli? Posso comunicare in italiano standard, siciliano, napoletano, romanesco, veneziano o sardo."
    },
    {
        name: "Thai",
        dialects: [
            "Central Thai",
            "Northern Thai",
            "Isan"
        ],
        welcome: "สวัสดีค่ะ/ครับ! ฉันเป็นเพื่อนภาษาของคุณ ฉันอยู่ที่นี่เพื่อช่วยให้คุณเรียนรู้ภาษาใหม่ โปรดส่งข้อความถึงฉันในภาษาแม่ของคุณ!",
        "ask-dialect": "ดีมาก! คุณพูดภาษาไทยสำเนียงไหน? ฉันสามารถสื่อสารในภาษาไทยกลาง ภาษาไทยเหนือ หรือภาษาอีสานได้"
    },
    {
        name: "Polish",
        dialects: [
            "Standard Polish",
            "Silesian",
            "Greater Polish"
        ],
        welcome: "Cześć! Jestem Twoim językowym przyjacielem, tutaj aby pomóc Ci nauczyć się nowego języka. Proszę, napisz do mnie w swoim ojczystym języku!",
        "ask-dialect": "Świetnie! Jaką odmianę polskiego mówisz? Mogę komunikować się w standardowym polskim, śląskim lub wielkopolskim."
    },
    {
        name: "Dutch",
        dialects: [
            "Netherlands Dutch",
            "Belgian Dutch (Flemish)"
        ],
        welcome: "Hallo! Ik ben je taalmaatje, hier om je te helpen een nieuwe taal te leren. Stuur me alsjeblieft een bericht in je moedertaal!"
    },
    {
        name: "Czech",
        dialects: [
            "Standard Czech",
            "Moravian"
        ],
        welcome: "Ahoj! Jsem tvůj jazykový partner a jsem tu, abych ti pomohl naučit se nový jazyk. Prosím, napiš mi ve svém rodném jazyce!",
        "ask-dialect": "Výborně! Jakou variantu češtiny mluvíš? Umím komunikovat ve standardní češtině nebo moravštině."
    },
    {
        name: "Hungarian",
        dialects: [
            "Standard Hungarian",
            "Transylvanian Hungarian"
        ],
        welcome: "Szia! Én vagyok a nyelvi társad, azért vagyok itt, hogy segítsek neked új nyelvet tanulni. Kérlek, küldj nekem üzenetet az anyanyelveden!",
        "ask-dialect": "Nagyszerű! Milyen magyar nyelvváltozatot beszélsz? Tudok kommunikálni a standard magyarban vagy az erdélyi magyarban."
    },
    {
        name: "Swedish",
        dialects: [
            "Standard Swedish (Rikssvenska)",
            "Scanian",
            "Finland Swedish"
        ],
        welcome: "Hej! Jag är din språkpartner, här för att hjälpa dig att lära dig ett nytt språk. Vänligen skicka ett meddelande till mig på ditt modersmål!",
        "ask-dialect": "Utmärkt! Vilken variant av svenska talar du? Jag kan kommunicera på rikssvenska, skånska eller finlandssvenska."
    },
    {
        name: "Danish",
        dialects: [
            "Standard Danish",
            "Jutlandic",
            "Bornholmian"
        ],
        welcome: "Hej! Jeg er din sprogpartner, og jeg er her for at hjælpe dig med at lære et nyt sprog. Send mig venligst en besked på dit modersmål!",
        "ask-dialect": "Fremragende! Hvilken variant af dansk taler du? Jeg kan kommunikere på standarddansk, jysk eller bornholmsk."
    },
    {
        name: "Norwegian",
        dialects: [
            "Bokmål",
            "Nynorsk",
            "Trøndersk",
            "Northern Norwegian"
        ],
        welcome: "Hei! Jeg er din språkpartner, her for å hjelpe deg å lære et nytt språk. Vennligst send meg en melding på ditt morsmål!",
        "ask-dialect": "Flott! Hvilken variant av norsk snakker du? Jeg kan kommunisere på bokmål, nynorsk, trøndersk eller nordnorsk."
    },
    {
        name: "Finnish",
        dialects: [
            "Standard Finnish",
            "Southwestern Finnish",
            "Savonian"
        ],
        welcome: "Hei! Olen kielikumppanisi, täällä auttaakseni sinua oppimaan uuden kielen. Lähetä minulle viesti äidinkielelläsi!",
        "ask-dialect": "Hienoa! Mitä suomen murretta puhut? Voin kommunikoida yleiskielellä, lounaissuomalaisella murteella tai savolaisella murteella."
    },
    {
        name: "Bulgarian",
        dialects: [
            "Standard Bulgarian",
            "Western Bulgarian"
        ],
        welcome: "Здравейте! Аз съм вашият езиков партньор, тук съм, за да ви помогна да научите нов език. Моля, изпратете ми съобщение на родния си език!",
        "ask-dialect": "Чудесно! Кой вариант на български говорите? Мога да общувам на стандартен български или западнобългарски."
    },
    {
        name: "Serbian",
        dialects: [
            "Standard Serbian",
            "Vojvodina Serbian"
        ],
        welcome: "Здраво! Ја сам ваш језички партнер, овде сам да вам помогнем да научите нови језик. Молим вас да ми пошаљете поруку на матерњем језику!",
        "ask-dialect": "Одлично! Коју варијанту српског језика говорите? Могу да комуницирам на стандардном српском или војвођанском српском."
    },
    {
        name: "Croatian",
        dialects: [
            "Standard Croatian",
            "Dalmatian"
        ],
        welcome: "Bok! Ja sam tvoj jezični partner, ovdje sam da ti pomognem naučiti novi jezik. Molim te, pošalji mi poruku na svom materinjem jeziku!",
        "ask-dialect": "Izvrsno! Koju varijantu hrvatskog govoriš? Mogu komunicirati na standardnom hrvatskom ili dalmatinskom."
    },
    {
        name: "Slovak",
        dialects: [
            "Standard Slovak",
            "Eastern Slovak"
        ],
        welcome: "Ahoj! Som tvoj jazykový partner, som tu, aby som ti pomohol naučiť sa nový jazyk. Prosím, pošli mi správu vo svojom rodnom jazyku!",
        "ask-dialect": "Výborne! Akú variantu slovenčiny hovoríš? Viem komunikovať v štandardnej slovenčine alebo východoslovenskom nárečí."
    },
    {
        name: "Ukrainian",
        dialects: [
            "Standard Ukrainian",
            "Western Ukrainian"
        ],
        welcome: "Привіт! Я ваш мовний партнер, я тут, щоб допомогти вам вивчити нову мову. Будь ласка, надішліть мені повідомлення вашою рідною мовою!",
        "ask-dialect": "Чудово! Який варіант української мови ви розмовляєте? Я можу спілкуватися стандартною українською або західноукраїнською."
    },
    {
        name: "Hebrew",
        dialects: [
            "Modern Hebrew",
            "Ashkenazi Hebrew",
            "Mizrahi Hebrew"
        ],
        welcome: "שלום! אני שותף השפה שלך, כאן כדי לעזור לך ללמוד שפה חדשה. אנא שלח לי הודעה בשפת האם שלך!",
        "ask-dialect": "מצוין! איזה סגנון עברית אתה מדבר? אני יכול לתקשר בעברית מודרנית, עברית אשכנזית או עברית מזרחית."
    },
    {
        name: "Catalan",
        dialects: [
            "Central Catalan",
            "Valencian"
        ],
        welcome: "Hola! Sóc el teu company lingüístic, aquí per ajudar-te a aprendre un nou idioma. Si us plau, envia'm un missatge en la teva llengua materna!",
        "ask-dialect": "Genial! Quina variant del català parles? Puc comunicar-me en català central o valencià."
    },
    {
        name: "Basque",
        dialects: [
            "Standard Basque"
        ],
        welcome: "Kaixo! Zure hizkuntza laguna naiz, hizkuntza berri bat ikasten laguntzeko hemen nago. Mesedez, bidali mezu bat zure ama hizkuntzan!"
    },
    {
        name: "Galician",
        dialects: [
            "Standard Galician"
        ],
        welcome: "Ola! Son o teu compañeiro lingüístico, aquí para axudarche a aprender unha nova lingua. Por favor, envíame unha mensaxe na túa lingua materna!"
    },
    {
        name: "Lithuanian",
        dialects: [
            "Standard Lithuanian"
        ],
        welcome: "Labas! Aš esu jūsų kalbos draugas, čia padėti jums išmokti naują kalbą. Prašau atsiųsti man žinutę savo gimtąja kalba!"
    },
    {
        name: "Latvian",
        dialects: [
            "Standard Latvian"
        ],
        welcome: "Sveiki! Es esmu jūsu valodas partneris, šeit lai palīdzētu jums apgūt jaunu valodu. Lūdzu, sūtiet man ziņu savā dzimtajā valodā!"
    },
    {
        name: "Estonian",
        dialects: [
            "Standard Estonian"
        ],
        welcome: "Tere! Olen sinu keelepartner, siin selleks, et aidata sul uut keelt õppida. Palun saada mulle sõnum oma emakeeles!"
    },
    {
        name: "Slovene",
        dialects: [
            "Standard Slovene"
        ],
        welcome: "Zdravo! Jaz sem tvoj jezikovni partner, tukaj sem, da ti pomagam pri učenju novega jezika. Prosim, pošlji mi sporočilo v svojem maternem jeziku!"
    },
    {
        name: "Albanian",
        dialects: [
            "Tosk Albanian",
            "Gheg Albanian"
        ],
        welcome: "Përshëndetje! Unë jam partneri juaj gjuhësor, jam këtu për t'ju ndihmuar të mësoni një gjuhë të re. Ju lutem më dërgoni një mesazh në gjuhën tuaj amtare!",
        "ask-dialect": "Shkëlqyeshëm! Cilin variant të shqipes flisni? Mund të komunikoj në toskërishte ose në gegërishte."
    },
    {
        name: "Georgian",
        dialects: [
            "Standard Georgian"
        ],
        welcome: "გამარჯობა! მე ვარ თქვენი ენის პარტნიორი, აქ ვარ, რომ დაგეხმაროთ ახალი ენის შესწავლაში. გთხოვთ, გამომიგზავნოთ შეტყობინება თქვენს მშობლიურ ენაზე!"
    },
    {
        name: "Armenian",
        dialects: [
            "Eastern Armenian",
            "Western Armenian"
        ],
        welcome: "Բարև! Ես ձեր լեզվական գործընկերն եմ, այստեղ եմ՝ օգնելու ձեզ սովորել նոր լեզու: Խնդրում եմ ինձ ուղարկեք հաղորդագրություն ձեր մայրենի լեզվով!",
        "ask-dialect": "Հիանալի է! Հայերենի ո՞ր տարբերակն եք խոսում: Ես կարող եմ հաղորդակցվել արևելահայերենով կամ արևմտահայերենով:"
    },
    {
        name: "Icelandic",
        dialects: [
            "Standard Icelandic"
        ],
        welcome: "Halló! Ég er tungumálafélagi þinn, hér til að hjálpa þér að læra nýtt tungumál. Vinsamlegast sendu mér skilaboð á móðurmáli þínu!"
    },
    {
        name: "Maltese",
        dialects: [
            "Standard Maltese"
        ],
        welcome: "Bonġu! Jien il-sieħeb lingwistiku tiegħek, hawn biex ngħinek titgħallem lingwa ġdida. Jekk jogħġbok ibgħatli messaġġ fil-lingwa nattiva tiegħek!"
    },
    {
        name: "Welsh",
        dialects: [
            "North Welsh",
            "South Welsh"
        ],
        welcome: "Helo! Rwy'n bartner iaith i chi, yma i'ch helpu i ddysgu iaith newydd. Anfonwch neges ataf yn eich mamiaith!",
        "ask-dialect": "Gwych! Pa amrywiad o Gymraeg ydych chi'n ei siarad? Gallaf gyfathrebu yn Gymraeg Gogledd neu Gymraeg De."
    },
    {
        name: "Irish",
        dialects: [
            "Connacht Irish",
            "Munster Irish",
            "Ulster Irish"
        ],
        welcome: "Dia duit! Is mise do chompánach teanga, anseo chun cabhrú leat teanga nua a fhoghlaim. Seol teachtaireacht chugam i do theanga dhúchais!",
        "ask-dialect": "Iontach! Cén leagan Gaeilge a labhraíonn tú? Is féidir liom cumarsáid a dhéanamh i nGaeilge Chonnacht, Gaeilge na Mumhan, nó Gaeilge Uladh."
    },
    {
        name: "Scottish Gaelic",
        dialects: [
            "Standard Scottish Gaelic"
        ],
        welcome: "Halò! Is mise an compàirtiche cànain agad, an seo gus do chuideachadh le bhith ag ionnsachadh cànan ùr. Feuch an cuir thu teachdaireachd thugam nad chànan màthaireil!"
    },
    {
        name: "Afrikaans",
        dialects: [
            "Standard Afrikaans"
        ],
        welcome: "Hallo! Ek is jou taalvennoot, hier om jou te help om 'n nuwe taal te leer. Stuur asseblief vir my 'n boodskap in jou moedertaal!"
    },
    {
        name: "Bosnian",
        dialects: [
            "Standard Bosnian"
        ],
        welcome: "Zdravo! Ja sam tvoj jezički partner, ovdje sam da ti pomognem da naučiš novi jezik. Molim te, pošalji mi poruku na svom maternjem jeziku!"
    }
];