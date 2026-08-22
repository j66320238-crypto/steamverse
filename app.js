/* ============================================================
   StreamVerse v12.3 — client
   • Same-origin Node/Render API keeps credentials and quota off the browser
   • Multiple fallback embed sources with season/episode picker
   • Playlists (multiple, named) — Netflix-style
   • Live TV with custom HLS.js player (speed + quality controls, PiP, mute)
   • K-Drama / Asian drama category
   • Add-to-playlist from player, continue-watching with S/E
   • Fully mobile-optimised
   ============================================================ */
(() => {
  'use strict';

  // Single source of truth for cache busting. Must match the ?v= query strings
  // in index.html and the VERSION/SHELL constants in sw.js.
  const APP_VERSION = '12.4.0';

  // Earlier builds could leave "hide recommendations" stuck on after a bug,
  // and users had no obvious way to tell it apart from recommendations simply
  // not loading. Clear the flag once per new version; the Settings toggle
  // still works and its choice sticks until the next upgrade.
  try {
    if (localStorage.getItem('sv-recs-reset') !== APP_VERSION) {
      localStorage.setItem('sv-recs-reset', APP_VERSION);
      if (localStorage.getItem('sv-hide-recs') === '1') localStorage.setItem('sv-hide-recs', '0');
    }
  } catch (e) { /* private mode: nothing to reset */ }

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const IMG = 'https://image.tmdb.org/t/p/w342';
  const IMG_LARGE = 'https://image.tmdb.org/t/p/w500';
  const BACKDROP = 'https://image.tmdb.org/t/p/w1280';
  const CAST_IMG = 'https://image.tmdb.org/t/p/w185';

  const TMDB_KEY = ''; // Keep the production key on Render as TMDB_KEY; never send it to the browser
  const TMDB_BASE = 'https://api.themoviedb.org/3';
  const ANILIST_GRAPHQL = 'https://graphql.anilist.co';
  const ANILIST_VIDEO_QUERY = `query ($id: Int, $idMal: Int) {
    Media(id: $id, idMal: $idMal, type: ANIME) {
      id idMal title { romaji english native } coverImage { extraLarge large } bannerImage
      streamingEpisodes { title thumbnail url site } siteUrl
    }
  }`;

  const LANGS = [
    ['', 'Original'], ['en-US', 'English'], ['hi-IN', 'Hindi'],
    ['ta-IN', 'Tamil'], ['te-IN', 'Telugu'], ['ml-IN', 'Malayalam'],
    ['kn-IN', 'Kannada'], ['bn-IN', 'Bengali'], ['mr-IN', 'Marathi'],
    ['ja-JP', 'Japanese'], ['ko-KR', 'Korean'], ['zh-CN', 'Chinese'],
    ['es-ES', 'Spanish'], ['fr-FR', 'French'], ['de-DE', 'German'],
    ['pt-BR', 'Portuguese'], ['ru-RU', 'Russian'], ['ar-SA', 'Arabic'],
  ];

  const AUDIO_NAMES = {
    en: 'English', hi: 'Hindi', ta: 'Tamil', te: 'Telugu', ml: 'Malayalam', kn: 'Kannada',
    bn: 'Bengali', mr: 'Marathi', pa: 'Punjabi', gu: 'Gujarati', ja: 'Japanese', ko: 'Korean',
    zh: 'Chinese', es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese', ru: 'Russian',
    ar: 'Arabic', tr: 'Turkish', th: 'Thai', it: 'Italian', nl: 'Dutch', pl: 'Polish',
  };

  /* ================= INTERFACE LANGUAGE =================
     TMDB's content locale and the website interface are separate. Hindi now
     translates the actual UI instead of only asking TMDB for a Hindi title. */
  const UI_LANGS = [['en', 'English'], ['hi', 'हिन्दी']];
  const I18N = {
    en: {
      qualitySingle: 'Source provides one quality only', qualityReal: 'Direct stream — quality really switches',
    skipIntro: 'Skip intro',
    subtitles: 'Subtitles',
    subtitlesOff: 'Off',
    qualityAuto: 'Auto',
    nativePlayer: 'Direct stream',
      skipContent: 'Skip to content', home: 'Home', movies: 'Movies', tvShows: 'TV Shows', anime: 'Anime',
      drama: 'Drama', liveTV: 'Live TV', playlists: 'Playlists', myList: 'My List', myPlaylists: 'My Playlists',
      searchPlaceholder: 'Try “comedy”, “Hindi action”, a title…', watchNow: 'Watch Now', moreInfo: 'More Info',
      continueWatching: 'Continue Watching', trendingNow: 'Trending Now', popularMovies: 'Popular Movies', hindiOriginalsRow: 'Hindi Originals', hindiAudioGuaranteed: 'Original Hindi audio',
      topRatedMovies: 'Top Rated Movies', popularTV: 'Popular TV Shows', topRatedTV: 'Top Rated TV',
      asianDramas: 'K-Drama & Asian Dramas', seeAll: 'See all →', topAnime: 'Top Anime', airingNow: 'Airing Now',
      comingSoon: 'Coming Soon', horrorPicks: 'Horror Picks', comedyNights: 'Comedy Nights',
      actionAdventure: 'Action & Adventure', browse: 'Browse', back: 'Back', loadMore: 'Load more',
      noTitles: 'No titles found. Try something else.', newPlaylist: 'New Playlist', backPlaylists: '‹ Back to playlists',
      rename: 'Rename', liveSub: '24/7 public channels — availability can change by region.', watchingNow: 'watching now',
      nowPlaying: 'Now Playing', audio: 'Audio', preferredAudio: 'Preferred audio', audioPreferenceSetting: 'Preferred Audio', audioPreferenceSettingNote: 'Requests this audio from compatible players; unavailable dubs cannot be created by the site.',
      audioNote: 'Audio tracks depend on the selected provider. Use the provider player menu if your preference is unavailable.',
      swipeRecommendations: 'Swipe up for recommendations', recommended: 'Recommended for you', seeAllUp: 'See all ↑',
      swipeDown: 'Swipe down to return', reload: 'Reload', youMayLike: 'You may also like', episodes: 'Episodes',
      source: 'Source', prev: '‹ Prev', next: 'Next ›', mute: 'Mute', unmute: 'Unmute', clearAudio: 'Clear audio', voiceBoost: 'Voice Boost', voiceBoostOn: 'Voice Boost enabled', voiceBoostOff: 'Voice Boost disabled', voiceVolume: 'Voice Volume',
      settings: 'Settings', interfaceLanguage: 'Interface Language',
      interfaceLanguageNote: 'Changes website buttons, menus and messages.', contentLanguage: 'Titles & Description Language', contentLanguageNote: 'Titles and descriptions use this language where a translation exists.',
      countryNote: 'Used for official streaming options under the player.', sourceNote: 'Default source when you tap Watch.',
      emptyMyList: 'Your list is empty. Add a title to save it here.', emptyPlaylist: 'This playlist is empty. Browse and add a title.',
      footerTagline: 'Movies · TV Shows · Anime · Dramas · Live TV · Playlists', unmuteHint: 'If sound is muted, use the speaker button inside the video.',
      sourceHint: '(if one does not work, try another)', openSource: 'Open source',
      countryRegion: 'Country / Region', autoDetect: 'Auto-detect', preferredSource: 'Preferred player source',
      popupProtection: 'Popup & ad protection', theme: 'Theme', cachedData: 'Cached data (this browser)',
      resetStats: 'Reset stats', clearBrowserCache: 'Clear browser cache',
      movie: 'Movie', film: 'Film', series: 'Series', featured: 'Featured', match: 'Match', new: 'New',
      watch: 'Watch', details: 'Details', soon: 'Soon', retry: 'Retry', couldNotLoad: 'Could not load right now.',
      resultsFor: 'Results for “{query}”', all: 'All', topAll: 'Top All', korean: 'Korean', japanese: 'Japanese',
      chinese: 'Chinese', indian: 'Indian', turkish: 'Turkish', thai: 'Thai', allDramas: 'All Dramas',
      addedList: 'Added to My List', removedList: 'Removed from My List', inMyList: 'In My List', addMyList: 'Add to My List',
      searchFailed: 'Search failed. Please try again.', detailsFailed: 'Could not load details.', noSynopsis: 'No synopsis available.',
      seasonsEpisodes: 'Seasons & Episodes — tap an episode to watch', topCast: 'Top Cast', moreLikeThis: 'More Like This',
      loadingEpisodes: 'Loading episodes…', noEpisodeData: 'No episode data for this season.', episodesFailed: 'Could not load episodes.',
      animeVideo: 'Anime video', officialPreview: 'Official provider link',
      noAnimePreview: 'No embeddable official preview was published for this title.', officialAnimeLinks: 'Official anime links',
      officialUnavailable: 'Anime playback unavailable',
      animeUnavailableHelp: 'No regular player match was found for this anime. Open a licensed provider below or try another title.',
      autoBest: 'Auto (best)', pickingServer: 'Picking best server…', preparing: 'Preparing…', tryAgain: 'Try again',
      serverBusy: 'All servers are busy', nextServer: 'Next server', preferredAudioAuto: 'Auto (provider default)',
      animeAudio: 'Anime audio', animeSub: 'Subbed · original voices', animeDub: 'Dubbed · English voices',
      nextUpKicker: 'NEXT UP', tapToUnmute: 'Tap to unmute',
      animeDubUnavailable: 'Dub not available for this title',
      hindiPreferred: 'Hindi (when provider offers it)', languageUpdated: 'Language updated', interfaceUpdated: 'Interface changed to Hindi',
      regionUpdated: 'Region updated', regionDetected: 'Region detected: {region}', regionFailed: 'Could not detect region',
      browserCacheCleared: 'Browser cache cleared', darkToLight: 'Dark theme — switch to Light', lightToDark: 'Light theme — switch to Dark',
      dataUsed: 'Data used', requests: 'Requests', since: 'Since', savedTitles: 'Saved titles', serverStatus: 'Server status',
      online: 'Online', offline: 'Offline', idle: 'Idle', unavailable: 'Unavailable',
      connecting: 'Connecting…', streamUnavailable: 'Stream unavailable. Try another channel.', hlsUnsupported: 'Live TV is not supported in this browser.',
      audioEnhanced: 'Clear audio enabled', audioNormal: 'Normal audio restored', quality: 'Quality', speed: 'Speed',
      playbackSpeed: 'Playback speed', speedApplied: 'Playback speed: {speed}×', speedProviderNote: 'This provider uses its own speed menu.',
      collapse: 'Collapse', expand: 'Expand', hide: 'Hide', showRecommendations: 'Show recommendations', audioUnavailable: 'No audio-capable server available',
      recommendationsSetting: 'Recommendations while watching', recsShown: 'Recommendations shown', recsHidden: 'Recommendations hidden',
      subAudio: 'Subbed', dubAudio: 'Dubbed', animeAudio: 'Anime audio', qualityNote: 'Applied on players that support a quality cap.',
      smartResults: 'Smart results: {label}', filterAll: 'All', filterMovies: 'Movies', filterTV: 'TV', filterAnime: 'Anime',
      hindiOriginal: 'Hindi original audio', hindiRequested: 'Hindi audio requested', tryHindiSource: 'Try Hindi-dub source', audioNotGuaranteed: 'Dub availability is controlled by the selected provider.',
      resume: 'Resume', recentlyOpened: 'Recently opened', playlistName: 'Playlist name:', newPlaylistName: 'New playlist name:',
      emptyPlaylists: "You haven't created any playlists yet.", emptyPlaylistHint: 'Create a Weekend Watch or Anime Marathon list.',
      titlesCount: '{count} title', titlesCountPlural: '{count} titles', alreadyPlaylist: 'Already in playlist',
      addedPlaylist: 'Added to “{name}”', noOfficialServices: 'No official services found for your region.',
      officialOptionsUnavailable: 'Official options unavailable right now.', audioDefault: 'Audio: provider default',
      audioPreference: 'Preferred audio: {language}. Confirm the track inside the provider player.',
    },
    hi: {
      qualitySingle: 'यह स्रोत केवल एक ही क्वालिटी देता है', qualityReal: 'सीधी स्ट्रीम — क्वालिटी असल में बदलती है',
    skipIntro: 'इंट्रो स्किप करें',
    subtitles: 'सबटाइटल',
    subtitlesOff: 'बंद',
    qualityAuto: 'ऑटो',
    nativePlayer: 'सीधी स्ट्रीम',
      skipContent: 'मुख्य सामग्री पर जाएँ', home: 'होम', movies: 'फ़िल्में', tvShows: 'टीवी शो', anime: 'ऐनिमे',
      drama: 'ड्रामा', liveTV: 'लाइव टीवी', playlists: 'प्लेलिस्ट', myList: 'मेरी सूची', myPlaylists: 'मेरी प्लेलिस्ट',
      searchPlaceholder: '“कॉमेडी”, “हिन्दी एक्शन” या कोई नाम खोजें…', watchNow: 'अभी देखें', moreInfo: 'और जानकारी',
      continueWatching: 'देखना जारी रखें', trendingNow: 'अभी ट्रेंडिंग', popularMovies: 'लोकप्रिय फ़िल्में', hindiOriginalsRow: 'मूल हिन्दी फ़िल्में', hindiAudioGuaranteed: 'मूल हिन्दी ऑडियो',
      topRatedMovies: 'टॉप रेटेड फ़िल्में', popularTV: 'लोकप्रिय टीवी शो', topRatedTV: 'टॉप रेटेड टीवी',
      asianDramas: 'के-ड्रामा और एशियाई ड्रामा', seeAll: 'सभी देखें →', topAnime: 'टॉप ऐनिमे', airingNow: 'अभी प्रसारित',
      comingSoon: 'जल्द आ रहा है', horrorPicks: 'हॉरर पसंद', comedyNights: 'कॉमेडी नाइट्स',
      actionAdventure: 'एक्शन और एडवेंचर', browse: 'ब्राउज़ करें', back: 'वापस', loadMore: 'और दिखाएँ',
      noTitles: 'कोई शीर्षक नहीं मिला। कुछ और खोजें।', newPlaylist: 'नई प्लेलिस्ट', backPlaylists: '‹ प्लेलिस्ट पर वापस',
      rename: 'नाम बदलें', liveSub: '24/7 सार्वजनिक चैनल — उपलब्धता क्षेत्र के अनुसार बदल सकती है।', watchingNow: 'अभी देख रहे हैं',
      nowPlaying: 'अभी चल रहा है', audio: 'ऑडियो', preferredAudio: 'पसंदीदा ऑडियो', audioPreferenceSetting: 'पसंदीदा ऑडियो', audioPreferenceSettingNote: 'संगत प्लेयर से यह ऑडियो माँगा जाएगा; जो डब मौजूद नहीं है उसे साइट बना नहीं सकती।',
      audioNote: 'ऑडियो ट्रैक चुने गए प्रदाता पर निर्भर हैं। भाषा न मिले तो वीडियो प्लेयर के मेनू में चुनें।',
      swipeRecommendations: 'सुझावों के लिए ऊपर स्वाइप करें', recommended: 'आपके लिए सुझाव', seeAllUp: 'सभी देखें ↑',
      swipeDown: 'वापस आने के लिए नीचे स्वाइप करें', reload: 'फिर लोड करें', youMayLike: 'आपको यह भी पसंद आ सकता है',
      episodes: 'एपिसोड', source: 'सर्वर', prev: '‹ पिछला', next: 'अगला ›', mute: 'म्यूट', unmute: 'आवाज़ चालू',
      clearAudio: 'साफ़ ऑडियो', voiceBoost: 'वॉइस बूस्ट', voiceBoostOn: 'वॉइस बूस्ट चालू', voiceBoostOff: 'वॉइस बूस्ट बंद', voiceVolume: 'आवाज़ की ताकत', settings: 'सेटिंग्स', interfaceLanguage: 'वेबसाइट की भाषा',
      interfaceLanguageNote: 'वेबसाइट के बटन, मेनू और संदेशों की भाषा बदलती है।', contentLanguage: 'शीर्षक और विवरण की भाषा', contentLanguageNote: 'जहाँ अनुवाद उपलब्ध है, शीर्षक और विवरण इसी भाषा में दिखेंगे।',
      countryNote: 'प्लेयर के नीचे आधिकारिक सेवाएँ दिखाने के लिए उपयोग होता है।', sourceNote: 'देखें दबाने पर खुलने वाला डिफ़ॉल्ट सर्वर।',
      emptyMyList: 'आपकी सूची खाली है। कोई शीर्षक जोड़कर यहाँ सहेजें।', emptyPlaylist: 'यह प्लेलिस्ट खाली है। कोई शीर्षक चुनकर इसमें जोड़ें।',
      footerTagline: 'फ़िल्में · टीवी शो · ऐनिमे · ड्रामा · लाइव टीवी · प्लेलिस्ट', unmuteHint: 'आवाज़ बंद हो तो वीडियो के अंदर स्पीकर बटन दबाएँ।',
      sourceHint: '(एक न चले तो दूसरा सर्वर आज़माएँ)', openSource: 'स्रोत खोलें',
      countryRegion: 'देश / क्षेत्र', autoDetect: 'अपने-आप पहचानें', preferredSource: 'पसंदीदा प्लेयर सर्वर',
      popupProtection: 'पॉपअप और विज्ञापन सुरक्षा', theme: 'थीम', cachedData: 'कैश डेटा (इस ब्राउज़र में)',
      resetStats: 'आँकड़े रीसेट करें', clearBrowserCache: 'ब्राउज़र कैश साफ़ करें',
      movie: 'फ़िल्म', film: 'फ़िल्म', series: 'सीरीज़', featured: 'विशेष', match: 'मैच', new: 'नया',
      watch: 'देखें', details: 'जानकारी', soon: 'जल्द', retry: 'फिर कोशिश करें', couldNotLoad: 'अभी लोड नहीं हो सका।',
      resultsFor: '“{query}” के नतीजे', all: 'सभी', topAll: 'सभी टॉप', korean: 'कोरियाई', japanese: 'जापानी',
      chinese: 'चीनी', indian: 'भारतीय', turkish: 'तुर्की', thai: 'थाई', allDramas: 'सभी ड्रामा',
      addedList: 'मेरी सूची में जोड़ दिया', removedList: 'मेरी सूची से हटा दिया', inMyList: 'मेरी सूची में', addMyList: 'मेरी सूची में जोड़ें',
      searchFailed: 'खोज नहीं हो सकी। फिर कोशिश करें।', detailsFailed: 'जानकारी लोड नहीं हो सकी।', noSynopsis: 'विवरण उपलब्ध नहीं है।',
      seasonsEpisodes: 'सीज़न और एपिसोड — देखने के लिए एपिसोड दबाएँ', topCast: 'मुख्य कलाकार', moreLikeThis: 'ऐसे और शीर्षक',
      loadingEpisodes: 'एपिसोड लोड हो रहे हैं…', noEpisodeData: 'इस सीज़न के एपिसोड उपलब्ध नहीं हैं।', episodesFailed: 'एपिसोड लोड नहीं हो सके।',
      animeVideo: 'ऐनिमे वीडियो', officialPreview: 'आधिकारिक प्रदाता लिंक',
      noAnimePreview: 'इस शीर्षक का एम्बेड होने वाला आधिकारिक प्रीव्यू उपलब्ध नहीं है।', officialAnimeLinks: 'आधिकारिक ऐनिमे लिंक',
      officialUnavailable: 'ऐनिमे प्लेबैक उपलब्ध नहीं है',
      animeUnavailableHelp: 'इस ऐनिमे का सामान्य प्लेयर मैच नहीं मिला। नीचे लाइसेंस प्राप्त सेवा खोलें या दूसरा शीर्षक आज़माएँ।',
      autoBest: 'ऑटो (सबसे अच्छा)', pickingServer: 'सबसे अच्छा सर्वर चुना जा रहा है…', preparing: 'तैयार हो रहा है…',
      tryAgain: 'फिर कोशिश करें', serverBusy: 'सभी सर्वर व्यस्त हैं', nextServer: 'अगला सर्वर', preferredAudioAuto: 'ऑटो (प्रदाता का डिफ़ॉल्ट)',
      animeAudio: 'ऐनिमे ऑडियो', animeSub: 'सब · मूल आवाज़ें', animeDub: 'डब · अंग्रेज़ी आवाज़ें',
      nextUpKicker: 'अगला', tapToUnmute: 'आवाज़ चालू करें',
      animeDubUnavailable: 'इस टाइटल के लिए डब उपलब्ध नहीं',
      hindiPreferred: 'हिन्दी (यदि प्रदाता पर उपलब्ध हो)', languageUpdated: 'कंटेंट की भाषा बदल दी गई', interfaceUpdated: 'वेबसाइट अब हिन्दी में है',
      regionUpdated: 'क्षेत्र बदल दिया गया', regionDetected: 'क्षेत्र मिला: {region}', regionFailed: 'क्षेत्र नहीं पहचाना जा सका',
      browserCacheCleared: 'ब्राउज़र कैश साफ़ हो गया', darkToLight: 'डार्क थीम — लाइट करें', lightToDark: 'लाइट थीम — डार्क करें',
      dataUsed: 'डेटा उपयोग', requests: 'रिक्वेस्ट', since: 'तब से', savedTitles: 'सहेजे शीर्षक', serverStatus: 'सर्वर स्थिति',
      online: 'ऑनलाइन', offline: 'ऑफ़लाइन', idle: 'खाली', unavailable: 'उपलब्ध नहीं', connecting: 'कनेक्ट हो रहा है…',
      streamUnavailable: 'स्ट्रीम उपलब्ध नहीं है। दूसरा चैनल आज़माएँ।', hlsUnsupported: 'इस ब्राउज़र में लाइव टीवी समर्थित नहीं है।',
      audioEnhanced: 'साफ़ ऑडियो चालू है', audioNormal: 'सामान्य ऑडियो बहाल', quality: 'क्वालिटी', speed: 'स्पीड',
      playbackSpeed: 'वीडियो स्पीड', speedApplied: 'वीडियो स्पीड: {speed}×', speedProviderNote: 'इस सर्वर का अपना स्पीड मेनू है।',
      collapse: 'छोटा करें', expand: 'बड़ा करें', hide: 'छिपाएँ', showRecommendations: 'सुझाव दिखाएँ', audioUnavailable: 'कोई ऑडियो-सक्षम सर्वर उपलब्ध नहीं',
      recommendationsSetting: 'देखते समय सुझाव', recsShown: 'सुझाव दिख रहे हैं', recsHidden: 'सुझाव छिपे हैं',
      subAudio: 'सब', dubAudio: 'डब', animeAudio: 'ऐनिमे ऑडियो', qualityNote: 'जो प्लेयर क्वालिटी कैप सपोर्ट करते हैं, उन पर लागू होगा।',
      smartResults: 'स्मार्ट नतीजे: {label}', filterAll: 'सभी', filterMovies: 'फ़िल्में', filterTV: 'टीवी', filterAnime: 'ऐनिमे',
      hindiOriginal: 'मूल हिन्दी ऑडियो', hindiRequested: 'हिन्दी ऑडियो माँगा गया', tryHindiSource: 'हिन्दी-डब सर्वर आज़माएँ', audioNotGuaranteed: 'डब की उपलब्धता चुने गए सर्वर पर निर्भर है।',
      resume: 'जारी रखें', recentlyOpened: 'हाल में खोला', playlistName: 'प्लेलिस्ट का नाम:', newPlaylistName: 'नई प्लेलिस्ट का नाम:',
      emptyPlaylists: 'आपने अभी कोई प्लेलिस्ट नहीं बनाई है।', emptyPlaylistHint: 'वीकेंड वॉच या ऐनिमे मैराथन सूची बनाएँ।',
      titlesCount: '{count} शीर्षक', titlesCountPlural: '{count} शीर्षक', alreadyPlaylist: 'पहले से प्लेलिस्ट में है',
      addedPlaylist: '“{name}” में जोड़ दिया', noOfficialServices: 'आपके क्षेत्र में कोई आधिकारिक सेवा नहीं मिली।',
      officialOptionsUnavailable: 'आधिकारिक विकल्प अभी उपलब्ध नहीं हैं।', audioDefault: 'ऑडियो: प्रदाता का डिफ़ॉल्ट',
      audioPreference: 'पसंदीदा ऑडियो: {language}। वीडियो प्लेयर के अंदर ट्रैक की पुष्टि करें।',
    },
  };

  function t(key, vars = {}) {
    const lang = (typeof state !== 'undefined' && state.uiLang) || 'en';
    let value = (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key;
    Object.entries(vars).forEach(([name, replacement]) => {
      value = value.replaceAll(`{${name}}`, String(replacement));
    });
    return value;
  }

  function setElementLabel(el, value) {
    if (!el) return;
    const textNodes = Array.from(el.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE && node.nodeValue.trim());
    if (!el.children.length || !textNodes.length) {
      el.textContent = value;
      return;
    }
    textNodes.slice(0, -1).forEach((node) => { node.nodeValue = ''; });
    textNodes[textNodes.length - 1].nodeValue = ` ${value}`;
  }

  function applyUiLanguage() {
    const lang = state.uiLang === 'hi' ? 'hi' : 'en';
    document.documentElement.lang = lang;
    document.documentElement.dir = 'ltr';
    $$('[data-i18n]').forEach((el) => setElementLabel(el, t(el.dataset.i18n)));
    $$('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    document.title = lang === 'hi'
      ? 'StreamVerse — फ़िल्में, टीवी शो, ऐनिमे और लाइव टीवी'
      : 'StreamVerse — Movies, TV Shows, Anime & Live TV';
  }

  /* ========= STREAM SOURCES =========
     Cross-origin providers control their own catalogues. "audioRequest"
     means the provider documents an audio-language preference; it is still
     only applied when that title actually carries the requested track. */
  const providerAudioName = (code) => ({
    hi:'Hindi', en:'English', ta:'Tamil', te:'Telugu', ml:'Malayalam', kn:'Kannada',
    bn:'Bengali', mr:'Marathi', pa:'Punjabi', ur:'Urdu', gu:'Gujarati',
    ja:'Japanese', ko:'Korean', es:'Spanish', fr:'French', de:'German',
    it:'Italian', pt:'Portuguese', ru:'Russian', zh:'Chinese', ar:'Arabic', tr:'Turkish',
  })[String(code || '').slice(0,2).toLowerCase()] || '';
  const withQuery = (base, values) => {
    const query = new URLSearchParams();
    Object.entries(values).forEach(([key, value]) => {
      if (value !== '' && value != null && value !== false) query.set(key, String(value));
    });
    return base + (base.includes('?') ? '&' : '?') + query.toString();
  };
  // Quality hint passed to providers that document a max-height / quality param.
  const QUALITY_VALUES = ['auto', '2160', '1080', '720', '480', '360'];
  const qualityHeight = (q) => (q && q !== 'auto' ? String(q) : '');


  const STREAM_SOURCES = [
    { id:'videasy', name:'Videasy · 4K + Dub', color:'#6366f1', priority:34, audioRequest:true, progressEvents:true, qualitySelect:true,
      movie:(id,lang,speed,quality)=>withQuery(`https://player.videasy.to/movie/${id}`,{color:'e50914',autoplay:'true',dub:lang&&lang!=='en'?'true':'',audio:providerAudioName(lang),maxQuality:qualityHeight(quality)}),
      tv:(id,s,e,lang,speed,quality)=>withQuery(`https://player.videasy.to/tv/${id}/${s}/${e}`,{color:'e50914',autoplay:'true',nextEpisode:'true',episodeSelector:'true',dub:lang&&lang!=='en'?'true':'',audio:providerAudioName(lang),maxQuality:qualityHeight(quality)}) },
    { id:'vidfast', name:'VidFast · Fast CDN', color:'#0ea5e9', priority:32, qualitySelect:true, progressEvents:true,
      movie:(id,lang,speed,quality)=>withQuery(`https://vidfast.vc/movie/${id}`,{theme:'e50914',autoPlay:'true',lang:lang||'',startingQuality:qualityHeight(quality)}),
      tv:(id,s,e,lang,speed,quality)=>withQuery(`https://vidfast.vc/tv/${id}/${s}/${e}`,{theme:'e50914',autoPlay:'true',nextButton:'true',autoNext:'true',lang:lang||'',startingQuality:qualityHeight(quality)}) },
    { id:'vidcore', name:'VidCore · Multi-source', color:'#8b5cf6', priority:30, nativeSpeed:true, originalAudio:true,
      movie:(id,lang)=>withQuery(`https://vidcore.org/embed/movie/${id}`,{lang:lang||'',autoplay:'true',theme:'e50914'}),
      tv:(id,s,e,lang)=>withQuery(`https://vidcore.org/embed/tv/${id}/${s}/${e}`,{lang:lang||'',autoplay:'true',theme:'e50914'}) },
    { id:'apiplayer', name:'APIPlayer · Speed control', color:'#22c55e', priority:26, remoteSpeed:true,
      movie:(id,lang)=>withQuery(`https://apiplayer.ru/embed/movie/${id}`,{autoplay:1,lang:lang||'',resume:'auto',color:'e50914'}),
      tv:(id,s,e,lang)=>withQuery(`https://apiplayer.ru/embed/tv/${id}/${s}/${e}`,{autoplay:1,lang:lang||'',resume:'auto',color:'e50914'}) },
    { id:'vidlink', name:'VidLink · JW', color:'#14b8a6', priority:22, originalAudio:true,
      movie:(id,lang)=>withQuery(`https://vidlink.pro/movie/${id}`,{player:'jw',autoplay:'true',poster:'true',title:'true',nextbutton:'true',language:lang||''}),
      tv:(id,s,e,lang)=>withQuery(`https://vidlink.pro/tv/${id}/${s}/${e}`,{player:'jw',autoplay:'true',poster:'true',title:'true',nextbutton:'true',language:lang||''}) },
    // Peachify documents dub/audio selection, but its anti-bot gateway can
    // reject some regions. Keep it as an explicit Hindi-source option instead
    // of trapping Auto mode on a challenge page.
    { id:'vidsrc-to', name:'VidSrc.to', color:'#e50914', priority:14,
      movie:(id)=>`https://vidsrc.to/embed/movie/${id}`,
      tv:(id,s,e)=>`https://vidsrc.to/embed/tv/${id}/${s}/${e}` },
    { id:'vidsrc-me', name:'VidSrc.me', color:'#dc2626', priority:12,
      movie:(id)=>`https://vidsrcme.ru/embed/movie?tmdb=${id}`,
      tv:(id,s,e)=>`https://vidsrcme.ru/embed/tv?tmdb=${id}&season=${s}&episode=${e}` },
    { id:'vidsrc-su', name:'VidSrc.su', color:'#b91c1c', priority:10,
      movie:(id)=>`https://vidsrc.su/embed/movie/${id}`,
      tv:(id,s,e)=>`https://vidsrc.su/embed/tv/${id}/${s}/${e}` },
    { id:'vidsrc-cc', name:'VidSrc.cc v2', color:'#f43f5e', priority:16,
      movie:(id)=>`https://vidsrc.cc/v2/embed/movie/${id}?autoPlay=true`,
      tv:(id,s,e)=>`https://vidsrc.cc/v2/embed/tv/${id}/${s}/${e}?autoPlay=true` },
  ];

  /* ========= ANIME STREAM SOURCES =========
     These providers accept a MAL or AniList id directly plus an episode
     number, so anime no longer depends on a TMDB match existing. Each entry
     declares which id type it needs; sources whose id is missing are skipped. */
  const ANIME_SOURCES = [
    { id:'megaplay-sub', name:'MegaPlay · Sub', color:'#8b5cf6', priority:30, dub:false, idType:'any',
      url:(ids,ep)=>ids.mal?`https://megaplay.buzz/stream/mal/${ids.mal}/${ep}/sub`:`https://megaplay.buzz/stream/ani/${ids.anilist}/${ep}/sub` },
    { id:'megaplay-dub', name:'MegaPlay · Dub', color:'#a855f7', priority:28, dub:true, idType:'any',
      url:(ids,ep)=>ids.mal?`https://megaplay.buzz/stream/mal/${ids.mal}/${ep}/dub`:`https://megaplay.buzz/stream/ani/${ids.anilist}/${ep}/dub` },
    { id:'videasy-anime', name:'Videasy · Anime', color:'#6366f1', priority:26, idType:'anilist',
      url:(ids,ep,dub)=>withQuery(`https://player.videasy.to/anime/${ids.anilist}/${ep}`,{color:'e50914',autoplay:'true',dub:dub?'true':'',episodeSelector:'true'}) },
    { id:'vidlink-anime', name:'VidLink · Anime', color:'#14b8a6', priority:24, idType:'mal',
      url:(ids,ep,dub)=>withQuery(`https://vidlink.pro/anime/${ids.mal}/${ep}/${dub?'dub':'sub'}`,{player:'jw',autoplay:'true',title:'true',nextbutton:'true'}) },
    { id:'vidsrc-anime', name:'VidSrc · Anime', color:'#e50914', priority:20, idType:'any',
      url:(ids,ep,dub)=>`https://vidsrc.cc/v2/embed/anime/${ids.mal?ids.mal:'ani'+ids.anilist}/${ep}/${dub?'dub':'sub'}?autoPlay=true` },
  ];
  function animeSourcesFor(ids, wantDub) {
    return ANIME_SOURCES.filter((source) => {
      if (source.idType === 'mal' && !ids.mal) return false;
      if (source.idType === 'anilist' && !ids.anilist) return false;
      if (source.idType === 'any' && !ids.mal && !ids.anilist) return false;
      if (source.dub === true && !wantDub) return false;
      if (source.dub === false && wantDub) return false;
      return true;
    }).sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  const AUTO_ID = 'auto';
  function orderedSources(includeManual = false) {
    const player = state && state.player || {};
    return STREAM_SOURCES.filter((source) => includeManual || source.auto !== false).sort((a,b) => {
      const score = (source) => {
        let value = source.priority || 0;
        if (player.originalLanguage === 'hi' && source.originalAudio) value += 70;
        if (player.audioBoost && source.id === 'vidcore') value += 24;
        if (player.audioLang === 'hi' && source.audioRequest) value += 90;
        if (Number(player.speed || 1) !== 1 && source.remoteSpeed) value += 100;
        return value;
      };
      return score(b) - score(a);
    });
  }

  /* ========= LIVE TV CHANNELS (free public HLS) ========= */
  const LIVE_CHANNELS = [
    // India — verified public broadcaster/news manifests (checked 2026-08-22)
    { cat: 'News', name: 'Aaj Tak HD', logo: '🇮🇳', url: 'https://feeds.intoday.in/aajtak/api/aajtakhd/master.m3u8' },
    { cat: 'News', name: 'India Today', logo: '🇮🇳', url: 'https://indiatodaylive.akamaized.net/hls/live/2014320/indiatoday/indiatodaylive/playlist.m3u8' },
    { cat: 'News', name: 'NDTV 24x7', logo: '🇮🇳', url: 'https://ndtv24x7elemarchana.akamaized.net/hls/live/2003678/ndtv24x7/master.m3u8' },
    { cat: 'News', name: 'NDTV India', logo: '🇮🇳', url: 'https://ndtvindiaelemarchana.akamaized.net/hls/live/2003679/ndtvindia/master.m3u8' },
    { cat: 'News', name: 'ABP News', logo: '🇮🇳', url: 'https://d2l4ar6y3mrs4k.cloudfront.net/live-streaming/abpnews-livetv/master.m3u8' },
    { cat: 'News', name: 'DD News', logo: '🇮🇳', url: 'https://d3qs3d2rkhfqrt.cloudfront.net/out/v1/0811cd8c37ca4c409d5385a6cd2fa18b/index.m3u8' },
    { cat: 'News', name: 'News18 India', logo: '🇮🇳', url: 'https://n18syndication.akamaized.net/bpk-tv/News18_India_NW18_MOB/output01/master.m3u8' },
    { cat: 'News', name: 'News18 Bihar Jharkhand', logo: '📍', url: 'https://n18syndication.akamaized.net/bpk-tv/News18_Bihar_Jharkhand_NW18_MOB/output01/master.m3u8' },
    { cat: 'News', name: 'CNBC TV18', logo: '📈', url: 'https://n18syndication.akamaized.net/bpk-tv/CNBC_TV18_NW18_MOB/output01/index.m3u8' },
    { cat: 'News', name: 'WION', logo: '🌐', url: 'https://d7x8z4yuq42qn.cloudfront.net/index_1.m3u8' },
    { cat: 'News', name: 'Republic TV', logo: '🇮🇳', url: 'https://d3qs3d2rkhfqrt.cloudfront.net/out/v1/2e31d831f08640ff92f65003bdc89991/index.m3u8' },
    { cat: 'News', name: 'Republic Bharat', logo: '🇮🇳', url: 'https://vg-republictvlive.akamaized.net/v1/master/611d79b11b77e2f571934fd80ca1413453772ac7/vglive-sk-275673/main.m3u8' },
    { cat: 'News', name: 'CNBC Awaaz', logo: '📈', url: 'https://n18syndication.akamaized.net/bpk-tv/CNBC_Awaaz_NW18_MOB/output01/master.m3u8' },
    { cat: 'News', name: 'Good News Today', logo: '📰', url: 'https://cc-89m9zu7a2upfe.akamaized.net/hls/live/2016145/gnt/gntlive/playlist.m3u8' },
    { cat: 'News', name: 'Zee Business', logo: '💹', url: 'https://dwby15d04agvq.cloudfront.net/index_5.m3u8' },
    { cat: 'News', name: 'TV9 Bharatvarsh', logo: '🇮🇳', url: 'https://dyjmyiv3bp2ez.cloudfront.net/pub-iotv9hinjzgtpe/liveabr/playlist.m3u8' },
    { cat: 'News', name: 'News Nation', logo: '🗞️', url: 'https://d3qs3d2rkhfqrt.cloudfront.net/out/v1/6cd2f649739a45ca9de1daf81cc7d0f2/index.m3u8' },
    { cat: 'News', name: 'Kashish News', logo: '📍', url: 'https://server.thelegitpro.in/kashishnews/kashishnews/index.m3u8' },

    // Public-service channels
    { cat: 'Education', name: 'DD National', logo: '📺', url: 'https://d3qs3d2rkhfqrt.cloudfront.net/out/v1/40492a64c1db4a1385ba1a397d357d3a/index.m3u8' },
    { cat: 'Education', name: 'DD Bihar', logo: '🏛️', url: 'https://d2lk5u59tns74c.cloudfront.net/out/v1/380b0765f87741a4812bc952ec6fbf21/index.m3u8' },
    { cat: 'Education', name: 'DD Kisan', logo: '🌾', url: 'https://d2lk5u59tns74c.cloudfront.net/out/v1/4f053f2c12a24641bf701fb7f2376750/index.m3u8' },
    { cat: 'Education', name: 'Sansad TV 1', logo: '🏛️', url: 'https://d2lk5u59tns74c.cloudfront.net/out/v1/fff8f20221d5456e8922e689d71dedc3/index.m3u8' },
    { cat: 'Education', name: 'Sansad TV 2', logo: '🏛️', url: 'https://d2lk5u59tns74c.cloudfront.net/out/v1/e4182054dce340da9e0ff38b6b3658a4/index.m3u8' },
    { cat: 'Sports', name: 'DD Sports', logo: '🏅', url: 'https://d3qs3d2rkhfqrt.cloudfront.net/out/v1/b17adfe543354fdd8d189b110617cddd/index.m3u8' },
    { cat: 'Education', name: 'DD Uttar Pradesh', logo: '🏛️', url: 'https://d3qs3d2rkhfqrt.cloudfront.net/out/v1/70d4f6874fa64032a685e3123520f07d/index.m3u8' },
    { cat: 'Education', name: 'DD Rajasthan', logo: '🏛️', url: 'https://d2lk5u59tns74c.cloudfront.net/out/v1/5b6bbbf682b741ecbe279f75a4a9a3e6/index.m3u8' },
    { cat: 'Education', name: 'DD India', logo: '🌏', url: 'https://d3qs3d2rkhfqrt.cloudfront.net/out/v1/ceda14583477426aa162a65392d8ea07/index.m3u8' },
    { cat: 'Education', name: 'DD Urdu', logo: '📺', url: 'https://d3qs3d2rkhfqrt.cloudfront.net/out/v1/9b91e9007e754db39a8b32c6bfc5b24a/index.m3u8' },
    { cat: 'Education', name: 'DD Jharkhand', logo: '📍', url: 'https://d3qs3d2rkhfqrt.cloudfront.net/out/v1/e8c3741f8c154d3185831f4e31777fb2/index.m3u8' },

    // Free-to-air entertainment
    { cat: 'Entertainment', name: 'Dangal TV', logo: '🎭', url: 'https://live-dangal.akamaized.net/liveabr/playlist.m3u8' },
    { cat: 'Entertainment', name: 'Dangal 2', logo: '🎭', url: 'https://live-dangal2.akamaized.net/liveabr/playlist.m3u8' },
    { cat: 'Entertainment', name: 'Shemaroo TV', logo: '🎞️', url: 'https://airtelapp.shemaroo.com/shemarootv/smil:shemarootvadp.smil/playlist.m3u8' },
    { cat: 'Entertainment', name: 'Shemaroo Umang', logo: '✨', url: 'https://airtelapp.shemaroo.com/shemarooumang/smil:shemarooumangadp.smil/playlist.m3u8' },
    { cat: 'Entertainment', name: 'PTC Punjabi', logo: '🪯', url: 'https://d3qs3d2rkhfqrt.cloudfront.net/out/v1/3e22a9c278db4e3eb779afd42e41b0a6/index.m3u8' },
    { cat: 'Movies', name: 'Bhojpuri Cinema', logo: '🎬', url: 'https://live-bhojpuri.akamaized.net/liveabr/playlist.m3u8' },
    { cat: 'Music', name: '9XM', logo: '🎵', url: 'https://9xjio.wiseplayout.com/9XM/master.m3u8' },
    { cat: 'Music', name: '9X Jalwa', logo: '🎶', url: 'https://wiselp.wiseplayout.com/9X_Jalwa/master.m3u8' },
    { cat: 'Music', name: '9X Jhakaas', logo: '🎼', url: 'https://wiselp.wiseplayout.com/9X_Jhakaas/master.m3u8' },
    { cat: 'Music', name: '9X Tashan', logo: '🎤', url: 'https://wiselp.wiseplayout.com/9X_Tashan/master.m3u8' },
    { cat: 'Spiritual', name: 'Aastha', logo: '🕉️', url: 'https://aasthaott.akamaized.net/110923/smil:aasthatv.smil/index.m3u8' },
    { cat: 'Sports', name: 'Red Bull TV', logo: '🏎️', url: 'https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8' },

    // International public streams
    { cat: 'News', name: 'France 24 English', logo: '🇫🇷', url: 'https://live.france24.com/hls/live/2037218/F24_EN_HI_HLS/master_5000.m3u8' },
    { cat: 'News', name: 'DW English', logo: '🇩🇪', url: 'https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8' },
    { cat: 'News', name: 'Euronews English', logo: '🇪🇺', url: 'https://cdn-euronews.akamaized.net/live/eds/euronews-en/25002/index.m3u8' },
    { cat: 'News', name: 'TRT World', logo: '🇹🇷', url: 'https://tv-trtworld.medya.trt.com.tr/master.m3u8' },
    { cat: 'Entertainment', name: 'Arirang TV', logo: '🇰🇷', url: 'https://amdlive-ch01-ctnd-com.akamaized.net/arirang_1ch/smil:arirang_1ch.smil/playlist.m3u8' },
    { cat: 'News', name: 'Al Jazeera Arabic', logo: '🇶🇦', url: 'https://live-hls-web-aja.getaj.net/AJA/01.m3u8' },
  ];

  function readStoredJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value == null ? fallback : value;
    } catch (e) {
      localStorage.removeItem(key);
      return fallback;
    }
  }
  function readStoredArray(key) {
    const value = readStoredJson(key, []);
    return Array.isArray(value) ? value : [];
  }

  /* ========= STATE ========= */
  const state = {
    heroItems: [], heroIndex: 0, heroTimer: null, heroPaused: false, homeLoaded: false,
    detail: null,
    lang: localStorage.getItem('sv-lang') || 'en-US',
    uiLang: localStorage.getItem('sv-ui-lang') || ((localStorage.getItem('sv-lang') || '').startsWith('hi') ? 'hi' : 'en'),
    region: localStorage.getItem('sv-region') || '',
    country: localStorage.getItem('sv-country') || '',
    countries: [],
    watchlist: readStoredArray('sv-watchlist'),
    continue:  readStoredArray('sv-continue'),
    playlists: readStoredArray('sv-playlists'),
    browse: { page: 1, totalPages: 1, kind: 'movie', genre: 0, loading: false, apiPath: '' },
    search: { query: '', items: [], filter: 'all', intent: null },
    player: (() => {
      const saved = localStorage.getItem('sv-source');
      const validIds = new Set([AUTO_ID, ...STREAM_SOURCES.map(s=>s.id)]);
      return {
        active: false, title: '', media: 'movie', catalogueMedia:'movie', tmdbId: null, malId: null, animeId: null, animeSource: 'mal', backdrop: '',
        season: 1, episode: 1, seasons: [], episodes: [],
        source: (saved && validIds.has(saved)) ? saved : AUTO_ID,
        autoIdx: 0, autoTimer: null, _lastSrcAt: 0, loadToken: 0,
        audioLang: localStorage.getItem('sv-audio-lang') || (((localStorage.getItem('sv-lang')||'').startsWith('hi')||(localStorage.getItem('sv-ui-lang')||'')==='hi')?'hi':''),
        speed: Number(localStorage.getItem('sv-playback-speed') || 1),
        quality: localStorage.getItem('sv-quality') || 'auto',
        audioBoost: localStorage.getItem('sv-player-voice-boost') !== '0',
        originalLanguage: '', audioConfirmed: false,
        animeVideo: null,
        // Anime playback state (independent of the TMDB mapping)
        animeIds: { mal: null, anilist: null },
        animeEpisode: 1, animeEpisodeCount: 0, animeDub: localStorage.getItem('sv-anime-dub') === '1',
        animeSourceId: AUTO_ID, animeAutoIdx: 0, animeDirect: false,
        // Native HLS playback state
        nativeActive: false, nativeLevels: [], nativeSkip: null, nativeAudio: [], nativeProvider: '',
      };
    })(),
    sandbox: localStorage.getItem('sv-sandbox') === '1',
    useServer: location.protocol.startsWith('http') && !location.protocol.startsWith('file'),
    live: { hls:null,currentChannel:null,audioContext:null,audioSource:null,highpass:null,lowShelf:null,voiceEq:null,compressor:null,gain:null,enhanced:localStorage.getItem('sv-live-enhance')!=='0',boostLevel:Number(localStorage.getItem('sv-live-voice-volume')||1.3) },
  };

  let usage = readStoredJson('sv-usage', { bytes: 0, reqs: 0, since: Date.now() });
  if (!usage || typeof usage !== 'object') usage = { bytes: 0, reqs: 0, since: Date.now() };
  const saveUsage = () => localStorage.setItem('sv-usage', JSON.stringify(usage));
  const fmtMB = (b) => (b / 1048576).toFixed(2) + ' MB';

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const STAR = `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" style="display:inline-block;vertical-align:-1px"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/></svg>`;
  const CHECK = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;
  const PLUS  = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`;
  const PLAY_SM = `<svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;

  // matchMedia is absent in some embedded/legacy webviews — never let the
  // whole app fail to boot over a capability probe.
  const mq = (query) => { try { return typeof window.matchMedia === 'function' ? window.matchMedia(query) : null; } catch (e) { return null; } };
  const isTouch = (mq('(hover: none)') || {}).matches || 'ontouchstart' in window;
  if (isTouch) document.body.classList.add('touch');

  const apiCache = new Map();
  let networkBanner = false;

  /* ================= API LAYER (with direct fallback) ================= */
  async function rawFetch(url, opts = {}) {
    const ctrl = new AbortController();
    const externalSignal = opts.signal;
    const onAbort = () => ctrl.abort(externalSignal && externalSignal.reason);
    if (externalSignal) {
      if (externalSignal.aborted) onAbort();
      else externalSignal.addEventListener('abort', onAbort, { once: true });
    }
    const timer = setTimeout(() => ctrl.abort(new DOMException('Timed out', 'TimeoutError')), opts.timeout || 12000);
    const fetchOpts = { ...opts, signal: ctrl.signal };
    delete fetchOpts.timeout;
    try {
      const r = await fetch(url, fetchOpts);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally {
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
    }
  }

  async function directTmdb(path, params = {}, options = {}) {
    // Production always uses the same-origin Render API. This direct mode is
    // only for a developer who intentionally supplies a local browser key.
    if (!TMDB_KEY) throw new Error('Run the Node server and configure TMDB_KEY');
    const q = new URLSearchParams({ api_key: TMDB_KEY, language: state.lang || 'en-US', ...params }).toString();
    return rawFetch(`${TMDB_BASE}${path}?${q}`, options);
  }
  async function directJikan(path) {
    return rawFetch('https://api.jikan.moe/v4' + path);
  }

  async function directAnilist(query, variables = {}) {
    const data = await rawFetch(ANILIST_GRAPHQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    if (data.errors && data.errors.length) throw new Error(data.errors[0].message || 'AniList request failed');
    return data.data;
  }

  function normaliseAnimeVideos(media, animeId, fallbackTitle = 'Anime', animeSource = 'mal') {
    const title = (media && media.title && (media.title.english || media.title.romaji || media.title.native)) || fallbackTitle;
    const secureUrl = (value) => {
      try { const u = new URL(String(value)); if (u.protocol === 'http:') u.protocol = 'https:'; return /^https?:$/.test(u.protocol) ? u.toString() : ''; }
      catch (e) { return ''; }
    };
    const trailer = null;
    const episodes = (media && media.streamingEpisodes || []).filter((e) => e && e.url).slice(0, 40).map((e, i) => ({
      id: `${animeSource}-${animeId}-${i + 1}`, title: e.title || `Official episode ${i + 1}`,
      thumbnail: e.thumbnail || '', url: secureUrl(e.url), site: e.site || 'Official',
    }));
    const q = encodeURIComponent(title);
    return {
      ok: Boolean(episodes.length), source: 'AniList', id: Number(animeId), id_type: animeSource,
      mal_id: animeSource === 'mal' ? Number(animeId) : (media && media.idMal || null),
      anilist_id: animeSource === 'anilist' ? Number(animeId) : (media && media.id || null), title,
      trailer, episodes,
      official: [
        { name: 'Crunchyroll', url: `https://www.crunchyroll.com/search?q=${q}` },
        { name: 'Netflix', url: `https://www.netflix.com/search?q=${q}` },
        ...(media && media.siteUrl ? [{ name: 'AniList', url: media.siteUrl }] : []),
      ],
    };
  }

  async function directAnimeVideos(id, fallbackTitle, source = 'mal') {
    const vars = source === 'anilist' ? { id: Number(id) } : { idMal: Number(id) };
    const data = await directAnilist(ANILIST_VIDEO_QUERY, vars);
    if (!data || !data.Media) throw new Error('Anime not found');
    return normaliseAnimeVideos(data.Media, id, fallbackTitle, source);
  }

  async function api(p, { noCache = false, signal } = {}) {
    const parsed = new URL(p, 'https://streamverse.local');
    if (state.lang && !parsed.searchParams.has('lang')) parsed.searchParams.set('lang', state.lang);
    const url = parsed.pathname + (parsed.searchParams.toString() ? '?' + parsed.searchParams.toString() : '');
    if (!noCache) {
      const hit = apiCache.get(url);
      if (hit && Date.now() - hit.t < 4 * 60 * 1000) return hit.v;
    }
    const tryServer = async () => {
      const r = await fetch('/api' + url, { signal, headers: { Accept: 'application/json' } });
      if (!r.ok) {
        let msg = 'HTTP ' + r.status;
        try { const j = await r.json(); if (j && j.error) msg = j.error; } catch (e) {}
        throw new Error(msg);
      }
      return r.json();
    };
    const tryDirect = async () => {
      // Map server routes → direct API calls (works in file:// preview too)
      const u = new URL('http://x' + p);
      const qp = u.searchParams;
      const get = (k) => qp.get(k);
      const after = (pfx) => p.startsWith(pfx) ? p.slice(pfx.length).split('?')[0] : null;

      if (p.startsWith('/trending')) return directTmdb('/trending/all/week');
      if (p.startsWith('/movie/popular')) return directTmdb('/movie/popular');
      if (p.startsWith('/movie/hindi')) return directTmdb('/discover/movie', { with_original_language:'hi', sort_by:'popularity.desc', 'vote_count.gte':'20' });
      if (p.startsWith('/movie/top_rated')) return directTmdb('/movie/top_rated');
      if (p.startsWith('/movie/upcoming')) return directTmdb('/movie/upcoming');
      if (p.startsWith('/movie/now_playing')) return directTmdb('/movie/now_playing');
      if (p.startsWith('/tv/popular')) return directTmdb('/tv/popular');
      if (p.startsWith('/tv/top_rated')) return directTmdb('/tv/top_rated');
      if (p.startsWith('/search')) return directTmdb('/search/multi', { query: get('q'), include_adult: 'false', page: get('page') || '1' });
      if (p.startsWith('/details')) {
        const media = get('media'), id = get('id');
        return directTmdb(`/${media}/${id}`, { append_to_response: 'credits,similar,recommendations,content_ratings,release_dates,translations' });
      }
      if (p.startsWith('/tv/season')) return directTmdb(`/tv/${get('id')}/season/${get('s') || '1'}`);
      if (p.startsWith('/recommendations')) {
        const media = get('media'), id = get('id');
        const responses = await Promise.allSettled([
          directTmdb(`/${media}/${id}/recommendations`, { page: '1' }),
          directTmdb(`/${media}/${id}/similar`, { page: '1' }),
        ]);
        const results = responses.flatMap((r) => r.status === 'fulfilled' ? (r.value.results || []) : [])
          .filter((v, i, arr) => v && arr.findIndex((x) => x.id === v.id) === i).slice(0, 24);
        return { results };
      }
      if (p.startsWith('/watch')) return directTmdb(`/${get('media')}/${get('id')}/watch/providers`, { watch_region: get('region') || 'IN' });
      if (p.startsWith('/genres')) return directTmdb(`/genre/${get('media') === 'tv' ? 'tv' : 'movie'}/list`);
      if (p.startsWith('/movie/genre')) return directTmdb('/discover/movie', { with_genres: get('g'), sort_by: get('sort') || 'popularity.desc', 'vote_count.gte': '50', page: get('page') || '1' });
      if (p.startsWith('/tv/genre')) return directTmdb('/discover/tv', { with_genres: get('g'), sort_by: get('sort') || 'popularity.desc', 'vote_count.gte': '50', page: get('page') || '1' });
      if (p.startsWith('/drama/popular')) {
        // Korean / Asian dramas — discover with origin country KR + with_original_language
        return directTmdb('/discover/tv', { with_original_language: get('origin') || 'ko', sort_by: 'popularity.desc', page: get('page') || '1', 'vote_count.gte': '10' });
      }
      if (p.startsWith('/drama/trending')) return directTmdb('/trending/tv/week', { with_original_language: 'ko' });
      if (p.startsWith('/anime/genres')) return directJikan('/genres/anime').then((d) => ({ genres: (d.data || []).filter((g) => g.mal_id < 50 || g.mal_id === 62) }));
      if (p.startsWith('/anime/genre')) return directJikan(`/anime?genres=${get('g')}&order_by=members&sort=desc&sfw=true&page=${get('page') || '1'}`);
      if (p.startsWith('/anime/top')) return directJikan('/top/anime?page=' + (get('page') || '1'));
      if (p.startsWith('/anime/topairing')) return directJikan('/top/anime?filter=airing');
      if (p.startsWith('/anime/search')) return directJikan('/anime?q=' + encodeURIComponent(get('q') || '') + '&page=1');
      if (p.startsWith('/anime/details')) return directJikan(`/anime/${get('id')}/full`);
      if (p.startsWith('/anime/videos')) return directAnimeVideos(get('id'), get('title') || 'Anime', get('source') || 'mal');
      if (p.startsWith('/anime/tmdb')) {
        // client-side MAL → TMDB mapping
        const j = await directJikan(`/anime/${get('id')}/full`);
        const a = j.data || {};
        const title = a.title_english || a.title || '';
        const yr = a.year ? String(a.year) : (a.aired && a.aired.from ? String(a.aired.from).slice(0,4) : '');
        const r = await directTmdb('/search/tv', { query: title, first_air_date_year: yr, include_adult: 'false' });
        const res = r.results || [];
        let best = res.find((x) => x.name && x.name.toLowerCase() === title.toLowerCase()) || res[0];
        let media = 'tv';
        if (!best) {
          const rm = await directTmdb('/search/movie', { query: title, year: yr, include_adult: 'false' });
          best = (rm.results || [])[0]; media = 'movie';
        }
        if (!best) return { tmdb_id: null, media: 'tv', error: 'no_tmdb_match' };
        return { tmdb_id: best.id, media, title: best.name || best.title };
      }
      if (p.startsWith('/countries')) {
        const list = await directTmdb('/configuration/countries');
        return { countries: (list || []).map((c) => ({ code: c.iso_3166_1, name: c.english_name, native: c.native_name })) };
      }
      if (p.startsWith('/geo')) return { country_code: 'IN', country: 'India', flag: '🇮🇳' };
      if (p.startsWith('/stats')) return { version: '11.1.0-client', uptime_s: 0, api_health: { tmdb: 'ok', jikan: 'ok' }, cache_items: 0, requests: 0, backups_used: {} };
      if (p.startsWith('/cache/clear')) return { ok: true, cleared: 0 };
      if (p.startsWith('/health')) return { ok: true, version: '11.1.0-client' };
      throw new Error('unknown api path: ' + p);
    };

    let data;
    // Render serves the frontend and API from one origin. Do not repeat a
    // failed server request directly against TMDB/Jikan; that doubled quota
    // use and made errors take twice as long.
    if (state.useServer) data = await tryServer();
    else data = await tryDirect();
    usage.reqs++;
    try { usage.bytes += JSON.stringify(data).length; } catch (e) {}
    if (usage.reqs % 4 === 0) saveUsage();
    if (!noCache) {
      apiCache.set(url, { t: Date.now(), v: data });
      if (apiCache.size > 80) apiCache.delete(apiCache.keys().next().value);
    }
    return data;
  }

  function showNetworkBanner() {
    if (networkBanner) return; networkBanner = true;
    const b = document.createElement('div');
    b.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:999;max-width:92vw;background:#7c2d12;color:#ffedd5;padding:13px 20px;border-radius:12px;box-shadow:0 20px 50px rgba(0,0,0,.6);font-size:13.5px;text-align:center;line-height:1.5;border:1px solid #c2410c';
    b.textContent = 'Could not connect. Check your internet and try again.';
    document.body.appendChild(b);
    setTimeout(() => { b.remove(); networkBanner = false; }, 9000);
  }
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove('show'), 2400);
  }

  const year = (d) => (d ? String(d).split('-')[0] || '—' : '—');
  const runtimeFmt = (m) => {
    if (!m) return '';
    if (typeof m === 'string') return m;
    const h = Math.floor(m/60), min = m%60;
    return h ? `${h}h ${min}m` : `${min}m`;
  };
  const posterUrl = (p) => !p ? placeholderPoster() : (String(p).startsWith('http') ? p : IMG + p);
  const backdropUrl = (p) => !p ? '' : (String(p).startsWith('http') ? p : BACKDROP + p);
  const titleOf = (m) => m.title || m.name || m.title_english || '';
  const mediaOf = (m) => m.media_type === 'tv' || m.first_air_date || m.number_of_seasons ? 'tv' : 'movie';
  function animeRef(a = {}) {
    const source = a.anime_source || a.animeSource || (a.mal_id ? 'mal' : 'anilist');
    const id = source === 'mal' ? (a.mal_id || a.id) : (a.anilist_id || a.id);
    return { id: Number(id), source: source === 'anilist' ? 'anilist' : 'mal' };
  }

  function placeholderPoster() {
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="342" height="513"><rect width="100%" height="100%" fill="#15151f"/><text x="50%" y="50%" fill="#3b4259" font-family="Arial" font-size="20" font-weight="800" letter-spacing="2" text-anchor="middle" dominant-baseline="middle">STREAMVERSE</text></svg>');
  }
  const stillPlaceholder = () => 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="135"><rect width="100%" height="100%" fill="#15151f"/></svg>');
  function matchScore(m) { if (!m.vote_average) return null; return Math.min(99, Math.round(m.vote_average * 9.5 + 5)); }
  function certificationOf(d) {
    try {
      if (d.media_type === 'tv' || d.number_of_seasons) {
        const ratings = (d.content_ratings && d.content_ratings.results) || [];
        const us = ratings.find((x) => x.iso_3166_1 === 'US') || ratings[0];
        return us ? us.rating : '';
      }
      const releases = (d.release_dates && d.release_dates.results) || [];
      const us = releases.find((x) => x.iso_3166_1 === 'US') || releases[0];
      if (!us) return '';
      const r = (us.release_dates || []).find((x) => x.certification);
      return r ? r.certification : '';
    } catch (e) { return ''; }
  }

  /* ================= WATCHLIST / CONTINUE / PLAYLISTS ================= */
  function inWatchlist(id, media) { return state.watchlist.some((x) => String(x.id) === String(id) && x.media === media); }
  function toggleWatchlist(item) {
    const id = item.id, media = item.media_type || mediaOf(item);
    const idx = state.watchlist.findIndex((x) => String(x.id) === String(id) && x.media === media);
    if (idx >= 0) { state.watchlist.splice(idx,1); toast(t('removedList')); }
    else {
      state.watchlist.unshift({ id, media, animeSource: item.anime_source || item.animeSource || null, title: titleOf(item), poster: item.poster_path||'', backdrop: item.backdrop_path||'', vote_average: item.vote_average||0, release_date: item.release_date||item.first_air_date||'', addedAt: Date.now() });
      toast(t('addedList'));
    }
    localStorage.setItem('sv-watchlist', JSON.stringify(state.watchlist));
    updateWatchlistButtons(id, media);
    if (!$('#mylistView').classList.contains('hidden')) renderMyList();
    const card = document.querySelector(`.card[data-id="${id}"][data-media="${media}"]`);
    if (card) updateCardVisual(card);
  }
  function updateWatchlistButtons(id, media) {
    $$('.wl-btn').forEach((btn) => {
      if (btn.dataset.id === String(id) && btn.dataset.media === media) {
        const on = inWatchlist(id, media);
        btn.classList.toggle('in-list', on);
        btn.innerHTML = on ? CHECK : PLUS;
        btn.title = on ? t('inMyList') : t('addMyList');
      }
    });
  }
  function updateCardVisual(card) {
    const btn = card.querySelector('.wl-btn'); if (!btn) return;
    const on = inWatchlist(card.dataset.id, card.dataset.media);
    btn.classList.toggle('in-list', on);
    btn.innerHTML = on ? CHECK : PLUS;
  }
  function recordContinue(item, opts = {}) {
    const id=item.id, media=item.media_type||mediaOf(item);
    const isTv=media==='tv'||opts.season!=null;
    const previous=state.continue.find((entry)=>String(entry.id)===String(id)&&entry.media===media);
    const entry={
      id,media,animeSource:item.anime_source||item.animeSource||opts.animeSource||previous?.animeSource||null,
      title:titleOf(item)||previous?.title||'',poster:item.poster_path||previous?.poster||'',backdrop:item.backdrop_path||previous?.backdrop||'',
      vote_average:item.vote_average||previous?.vote_average||0,release_date:item.release_date||item.first_air_date||previous?.release_date||'',
      season:isTv?(opts.season||state.player.season||previous?.season||1):null,
      episode:isTv?(opts.episode||state.player.episode||previous?.episode||1):null,
      progress:Number.isFinite(opts.progress)?Math.max(0,Math.min(100,opts.progress)):(previous?.progress||0),
      position:Number.isFinite(opts.position)?opts.position:(previous?.position||0),
      duration:Number.isFinite(opts.duration)?opts.duration:(previous?.duration||0),at:Date.now(),
    };
    state.continue=state.continue.filter((value)=>!(String(value.id)===String(id)&&value.media===media));
    state.continue.unshift(entry); state.continue=state.continue.slice(0,12);
    localStorage.setItem('sv-continue',JSON.stringify(state.continue));
    renderContinueRow();
  }
  let lastProgressSave=0;
  function updateCurrentProgress(position,duration) {
    const player=state.player;
    if(!player.active||!player.tmdbId||!Number.isFinite(position)||!Number.isFinite(duration)||duration<=0)return;
    const now=Date.now(); if(now-lastProgressSave<5000)return; lastProgressSave=now;
    const anime=player.catalogueMedia==='anime';
    recordContinue({id:anime?player.animeId:player.tmdbId,media_type:anime?'anime':player.media,anime_source:anime?player.animeSource:null,title:player.title,poster_path:player.poster||'',backdrop_path:player.backdrop||''},{
      animeSource:anime?player.animeSource:null,season:player.media==='tv'?player.season:null,episode:player.media==='tv'?player.episode:null,
      position,duration,progress:Math.round(position/duration*100),
    });
  }

  function loadPlaylists() { state.playlists = readStoredArray('sv-playlists'); }
  function savePlaylists() { localStorage.setItem('sv-playlists', JSON.stringify(state.playlists)); }
  function createPlaylist(name) {
    const pl = { id: 'pl_' + Date.now() + '_' + Math.random().toString(36).slice(2,7), name: name || 'New Playlist', items: [], createdAt: Date.now() };
    state.playlists.unshift(pl); savePlaylists(); return pl;
  }
  function addToPlaylist(plId, item) {
    const pl = state.playlists.find((p) => p.id === plId); if (!pl) return;
    if (pl.items.some((x) => String(x.id) === String(item.id) && x.media === item.media)) { toast(t('alreadyPlaylist')); return; }
    pl.items.unshift({ ...item, addedAt: Date.now() });
    savePlaylists();
    toast(t('addedPlaylist', { name: pl.name }));
  }
  function removeFromPlaylist(plId, id, media) {
    const pl = state.playlists.find((p) => p.id === plId); if (!pl) return;
    pl.items = pl.items.filter((x) => !(String(x.id) === String(id) && x.media === media));
    savePlaylists();
  }

  /* ================= CARDS ================= */
  function tmdbCard(m) {
    const el = document.createElement('div');
    el.className = 'card'; el.tabIndex = 0; el.setAttribute('role','button');
    const media = mediaOf(m);
    el.dataset.id = m.id; el.dataset.media = media;
    const title = titleOf(m);
    const safeTitle = esc(title);
    const badge = media === 'tv'
      ? `<span class="card-badge tv">${esc(t('series').toUpperCase())}</span>`
      : `<span class="card-badge">${esc(t('movie').toUpperCase())}</span>`;
    const rating = Number(m.vote_average) > 0 ? `<span class="card-rating">${STAR} ${Number(m.vote_average).toFixed(1)}</span>` : '';
    const onList = inWatchlist(m.id, media);
    const upcoming = !isReleased(m);
    const poster = posterUrl(m.poster_path);
    const srcset = m.poster_path && !String(m.poster_path).startsWith('http')
      ? ` srcset="${esc(IMG + m.poster_path)} 342w, ${esc(IMG_LARGE + m.poster_path)} 500w" sizes="(max-width:760px) 140px, 184px"`
      : '';
    el.innerHTML = `
      <img class="card-poster" loading="lazy" decoding="async" fetchpriority="low" src="${esc(poster)}"${srcset} alt="${safeTitle}" onerror="this.onerror=null;this.src='${placeholderPoster()}'">
      ${badge}
      ${String(m.original_language||'').toLowerCase()==='hi'?`<span class="card-audio-badge">🎧 ${esc(state.uiLang==='hi'?'मूल हिन्दी':'Hindi original')}</span>`:''}
      ${upcoming?`<span class="card-badge upcoming">${esc(t('soon').toUpperCase())}</span>`:''}
      ${rating}
      <div class="card-actions">
        <button class="card-action wl-btn ${onList?'in-list':''}" data-id="${m.id}" data-media="${media}" title="${esc(onList?t('inMyList'):t('addMyList'))}" aria-label="${esc(onList?t('inMyList'):t('addMyList'))}">${onList?CHECK:PLUS}</button>
      </div>
      <div class="card-info">
        <div class="card-title">${safeTitle}</div>
        <div class="card-sub"><span class="yr">${year(m.release_date||m.first_air_date||'')}</span><span class="dot"></span><span>${upcoming?t('comingSoon'):(media==='tv'?t('series'):t('film'))}</span></div>
      </div>
      <div class="card-hover-bar">
        ${upcoming
          ? `<button class="mini-btn disabled" disabled>${PLAY_SM} ${esc(t('soon'))}</button><button class="mini-btn" data-action="info">${esc(t('details'))}</button>`
          : `<button class="mini-btn play" data-action="play">${PLAY_SM} ${esc(t('watch'))}</button><button class="mini-btn" data-action="info">${esc(t('details'))}</button>`}
      </div>`;
    el.onclick = (e) => {
      if (e.target.closest('.wl-btn')) { toggleWatchlist(m); return; }
      if (upcoming) { openDetail(media, m.id, title); return; }
      if (e.target.closest('[data-action="play"]')) {
        recordContinue(m);
        openPlayer({ title, media, tmdbId: m.id, backdrop: backdropUrl(m.backdrop_path||m.poster_path) });
        return;
      }
      openDetail(media, m.id, title);
    };
    el.onkeydown = (e) => { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); openDetail(media, m.id, title); } };
    return el;
  }
  function animeCard(a) {
    const el = document.createElement('div');
    el.className = 'card'; el.tabIndex = 0; el.setAttribute('role','button');
    const img = (a.images && a.images.jpg && (a.images.jpg.large_image_url || a.images.jpg.image_url)) || '';
    const title = titleOf(a);
    const safeTitle = esc(title);
    const yr = a.year ? String(a.year) : (a.aired && a.aired.from ? year(a.aired.from) : '');
    const score = a.score || a.rating || 0;
    const ref = animeRef(a);
    if (!ref.id) return el;
    const onList = inWatchlist(ref.id, 'anime');
    const upcoming = a.status && /not yet aired|upcoming/i.test(a.status);
    el.dataset.id = ref.id; el.dataset.media = 'anime'; el.dataset.animeSource = ref.source;
    el.innerHTML = `
      <img class="card-poster" loading="lazy" decoding="async" fetchpriority="low" src="${esc(img||placeholderPoster())}" alt="${safeTitle}" onerror="this.onerror=null;this.src='${placeholderPoster()}'">
      <span class="card-badge anime">${esc(t('anime').toUpperCase())}</span>
      ${upcoming?`<span class="card-badge upcoming">${esc(t('comingSoon').toUpperCase())}</span>`:''}
      ${score?`<span class="card-rating">${STAR} ${Number(score).toFixed(1)}</span>`:''}
      <div class="card-actions"><button class="card-action wl-btn ${onList?'in-list':''}" data-id="${ref.id}" data-media="anime" title="${esc(onList?t('inMyList'):t('addMyList'))}" aria-label="${esc(onList?t('inMyList'):t('addMyList'))}">${onList?CHECK:PLUS}</button></div>
      <div class="card-info"><div class="card-title">${safeTitle}</div><div class="card-sub"><span class="yr">${yr||'—'}</span><span class="dot"></span><span>${upcoming?t('soon'):t('anime')}</span></div></div>
      <div class="card-hover-bar">
        ${upcoming
          ? `<button class="mini-btn disabled" disabled>${esc(t('soon'))}</button><button class="mini-btn" data-action="info">${esc(t('details'))}</button>`
          : `<button class="mini-btn play" data-action="play">${PLAY_SM} ${esc(t('watch'))}</button><button class="mini-btn" data-action="info">${esc(t('details'))}</button>`}
      </div>`;
    const item = {
      id: ref.id, mal_id: ref.source === 'mal' ? ref.id : null, anilist_id: ref.source === 'anilist' ? ref.id : null,
      anime_source: ref.source, media_type: 'anime', title, poster_path: img,
      vote_average: Number(score) || 0, release_date: String(a.year || ''),
    };
    el.onclick = (e) => {
      if (e.target.closest('.wl-btn')) { toggleWatchlist(item); return; }
      if (!upcoming && e.target.closest('[data-action="play"]')) {
        recordContinue(item, { animeSource: ref.source });
        openPlayer({ title, media: 'anime', animeId: ref.id, animeSource: ref.source, backdrop: img || '' });
        return;
      }
      openAnimeDetail(ref.id, img, title, ref.source);
    };
    el.onkeydown = (e) => {
      if (e.key==='Enter'||e.key===' ') { e.preventDefault(); openAnimeDetail(ref.id, img, title, ref.source); }
    };
    return el;
  }
  function continueCard(c) {
    const el = document.createElement('div');
    el.className = 'card'; el.tabIndex = 0; el.setAttribute('role','button');
    el.dataset.id = c.id; el.dataset.media = c.media;
    const titleSafe = esc(c.title), onList = inWatchlist(c.id, c.media);
    const progress=Number(c.progress)||0;
    const sub=c.season?`S${c.season} · E${c.episode}${progress?` · ${Math.round(progress)}%`:''}`:(progress?`${Math.round(progress)}% ${state.uiLang==='hi'?'देखा':'watched'}`:t('recentlyOpened'));
    el.innerHTML = `
      <img class="card-poster" loading="lazy" src="${esc(posterUrl(c.poster))}" alt="${titleSafe}" onerror="this.onerror=null;this.src='${placeholderPoster()}'">
      ${c.media==='anime'?'<span class="card-badge anime">ANIME</span>':c.media==='tv'?'<span class="card-badge tv">TV</span>':'<span class="card-badge">MOVIE</span>'}
      ${c.vote_average?`<span class="card-rating">${STAR} ${Number(c.vote_average).toFixed(1)}</span>`:''}
      <div class="card-actions"><button class="card-action wl-btn ${onList?'in-list':''}" data-id="${c.id}" data-media="${c.media}">${onList?CHECK:PLUS}</button></div>
      <div class="card-info"><div class="card-title">${titleSafe}</div><div class="card-sub"><span>${year(c.release_date)}</span><span class="dot"></span><span>${esc(sub)}</span></div></div>
      <div class="card-hover-bar"><button class="mini-btn play" data-action="play">${PLAY_SM} ${esc(t('resume'))}</button><button class="mini-btn" data-action="info">${esc(t('details'))}</button></div>`;
    el.onclick = (e) => {
      if (e.target.closest('.wl-btn')) { toggleWatchlist(c); return; }
      const resume = !!e.target.closest('[data-action="play"]');
      if (c.media === 'anime') {
        if (resume) openPlayer({ title: c.title, media:'anime', animeId: c.id, animeSource: c.animeSource || 'mal', backdrop: posterUrl(c.backdrop || c.poster) });
        else openAnimeDetail(c.id, null, c.title, c.animeSource || 'mal');
      } else {
        if (resume) openPlayer({ title: c.title, media: c.media, tmdbId: c.id, backdrop: posterUrl(c.backdrop), season: c.season||1, episode: c.episode||1 });
        else openDetail(c.media, c.id, c.title);
      }
    };
    return el;
  }

  /* ================= ROWS ================= */
  function fillRow(rowId, items, fn) {
    const row = document.getElementById(rowId); if (!row) return;
    row.innerHTML = '';
    const frag = document.createDocumentFragment();
    items.slice(0,20).forEach((it) => frag.appendChild(fn(it)));
    row.appendChild(frag);
  }
  function skelRow(rowId, n=14) {
    const row = document.getElementById(rowId); if (!row) return;
    row.innerHTML = '';
    for (let i=0;i<n;i++){ const s=document.createElement('div'); s.className='skel-card skel'; row.appendChild(s); }
  }
  function rowError(rowId, retryFn) {
    const row = document.getElementById(rowId); if (!row) return;
    row.innerHTML = '';
    const d = document.createElement('div'); d.className='row-error';
    d.innerHTML = `<span>${esc(t('couldNotLoad'))}</span>`;
    const b = document.createElement('button'); b.textContent = t('retry'); b.onclick = retryFn;
    d.appendChild(b); row.appendChild(d);
  }
  function loadRow(apiPath, rowId, cardFn) {
    const tryLoad = () => {
      skelRow(rowId);
      api(apiPath).then((data) => {
        let items = data.items || data.data || data.results || [];
        // filter out unreleased / future titles so user never sees a "not found"
        if (rowId !== 'rowUpcomingRow') items = items.filter(isReleased);
        if (items.length) fillRow(rowId, items.slice(0,20), cardFn);
        else rowError(rowId, tryLoad);
      }).catch((e) => { console.warn(e); rowError(rowId, tryLoad); });
    };
    tryLoad();
  }

  const homeRowObservers = [];
  function clearHomeRowObservers() {
    while (homeRowObservers.length) {
      try { homeRowObservers.pop().disconnect(); } catch (e) {}
    }
  }

  // Load only the rows near the viewport. This keeps the first paint fast and
  // avoids firing eleven upstream API requests at the same time on mobile.
  function loadRowWhenVisible(apiPath, rowId, cardFn, delay = 0) {
    const section = document.getElementById(rowId)?.closest('.row-section');
    let started = false;
    const run = () => {
      if (started) return;
      started = true;
      window.setTimeout(() => loadRow(apiPath, rowId, cardFn), delay);
    };
    if (!section || !('IntersectionObserver' in window)) { run(); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect(); run();
      }
    }, { rootMargin: '260px 0px' });
    observer.observe(section);
    homeRowObservers.push(observer);
  }

  // Returns true for a title that is released (release/air date in the past),
  // OR for items where we can't determine the date (don't over-filter anime etc).
  function isReleased(item) {
    if (!item) return false;
    const now = Date.now();
    const grace = 7 * 24 * 60 * 60 * 1000;
    const future = (value) => {
      if (!value) return false;
      const time = Date.parse(String(value).length === 10 ? value + 'T00:00:00' : value);
      return Number.isFinite(time) && time > now + grace;
    };
    const animeItem = item.media_type === 'anime' || item.mal_id != null || item.anilist_id != null || item.images;
    if (animeItem) {
      if (future(item.aired && item.aired.from)) return false;
      return !(item.status && /not yet aired|upcoming/i.test(item.status));
    }
    if (item.media_type === 'tv' || item.first_air_date) return !future(item.first_air_date);
    if (item.media_type === 'movie' || item.release_date || item.title) return !future(item.release_date);
    return true;
  }

  function loadHome() {
    state.homeLoaded = true;
    clearHomeRowObservers();
    ['rowTrendingRow','rowPopularRow','rowHindiRow','rowTopRatedRow','rowTvRow','rowTvTopRow','rowAnimeRow','rowAiringRow','rowUpcomingRow','rowHorrorRow','rowComedyRow','rowActionRow','rowDramaRow'].forEach(skelRow);
    renderContinueRow();

    // The hero + first visible rows are eager; everything else waits until
    // the user gets close to it. API responses are still cached by api().
    api('/trending').then((tr) => {
      const results = (tr.results||[]).filter((x) => x.backdrop_path || x.poster_path);
      state.heroItems = results.slice(0,8);
      fillRow('rowTrendingRow', state.heroItems.length ? state.heroItems : results.slice(0,20), tmdbCard);
      $('#rowTrendingCount').textContent = state.heroItems.length ? `Top ${state.heroItems.length} picks` : '';
      if (state.heroItems.length) initHero();
    }).catch((e) => { console.warn(e); rowError('rowTrendingRow', loadHome); });

    loadRow('/movie/popular', 'rowPopularRow', tmdbCard);
    loadRowWhenVisible('/movie/hindi', 'rowHindiRow', tmdbCard, 80);
    loadRow('/tv/popular', 'rowTvRow', tmdbCard);

    const animeFiltered = (rowId, path) => {
      skelRow(rowId);
      api(path).then((d) => {
        const items = (d.data||[]).filter(isReleased);
        if (items.length) fillRow(rowId, items.slice(0,20), animeCard);
        else rowError(rowId, () => animeFiltered(rowId, path));
      }).catch(() => rowError(rowId, () => animeFiltered(rowId, path)));
    };
    animeFiltered('rowAnimeRow', '/anime/top');

    [
      ['/movie/top_rated', 'rowTopRatedRow', tmdbCard],
      ['/tv/top_rated', 'rowTvTopRow', tmdbCard],
      ['/movie/upcoming', 'rowUpcomingRow', tmdbCard],
      ['/movie/genre?g=27', 'rowHorrorRow', tmdbCard],
      ['/movie/genre?g=35', 'rowComedyRow', tmdbCard],
      ['/movie/genre?g=28', 'rowActionRow', tmdbCard],
    ].forEach(([path, rowId, cardFn], i) => loadRowWhenVisible(path, rowId, cardFn, i * 70));

    loadRowWhenVisible('/anime/topairing', 'rowAiringRow', animeCard, 100);

    // Drama is a small promotional row; load it in the background without
    // delaying the first catalogue paint.
    window.setTimeout(() => {
      api('/drama/popular?origin=ko').then((d) => {
        const items = d.results || [];
        if (items.length) { fillRow('rowDramaRow', items.slice(0,16), tmdbCard); $('#dramaPromo').classList.remove('hidden'); }
      }).catch(() => {});
    }, 900);
  }

  function renderContinueRow() {
    const section = document.querySelector('[data-row="continue"]');
    if (!state.continue.length) { section.hidden = true; return; }
    section.hidden = false; fillRow('rowContinueRow', state.continue, continueCard);
  }

  /* ================= HERO ================= */
  function initHero() {
    if (!state.heroItems.length) return;
    renderHero(false);
    clearInterval(state.heroTimer);
    state.heroTimer = setInterval(() => { if (!state.heroPaused) nextHero(); }, 7500);
    $('#heroNext').onclick = () => { nextHero(); resetTimer(); };
    $('#heroPrev').onclick = () => { prevHero(); resetTimer(); };
    $('#hero').onmouseenter = () => { state.heroPaused = true; };
    $('#hero').onmouseleave = () => { state.heroPaused = false; };
    buildHeroDots();
  }
  function buildHeroDots() {
    const wrap = $('#heroDots'); wrap.innerHTML = '';
    state.heroItems.forEach((_, i) => {
      const b = document.createElement('button'); b.setAttribute('aria-label',`Slide ${i+1}`);
      b.onclick = () => { state.heroIndex = i; renderHero(true); resetTimer(); };
      wrap.appendChild(b);
    });
  }
  function resetTimer() { clearInterval(state.heroTimer); state.heroTimer = setInterval(() => { if (!state.heroPaused) nextHero(); }, 7500); }
  function renderHero(animate=true) {
    const it = state.heroItems[state.heroIndex]; if (!it) return;
    const media = mediaOf(it), bg = $('#heroBg'), url = backdropUrl(it.backdrop_path||it.poster_path);
    const imageToken = state.heroImageToken = (state.heroImageToken || 0) + 1;
    let imageApplied = false;
    const apply = () => {
      if (imageApplied || state.heroImageToken !== imageToken) return;
      imageApplied = true;
      bg.classList.remove('loaded','zoom');
      bg.style.opacity='0';
      window.setTimeout(() => {
        if (state.heroImageToken !== imageToken) return;
        bg.style.backgroundImage = url ? `url(${url})` : 'linear-gradient(135deg,#141421,#07070c)';
        bg.style.opacity='';
        requestAnimationFrame(() => {
          bg.classList.add('loaded');
          window.setTimeout(() => bg.classList.add('zoom'), 80);
        });
      }, animate ? 120 : 0);
    };
    if (url) {
      const preloader = new Image();
      preloader.decoding = 'async';
      preloader.onload = apply;
      preloader.onerror = apply;
      preloader.src = url;
      if (preloader.complete) apply();
    } else apply();
    const tags = $('#heroTags'), match = matchScore(it);
    tags.innerHTML = `<span class="hero-tag">${esc(t('featured'))}</span><span class="hero-tag gold">${esc(media==='tv'?t('series'):t('film'))}</span>${match?`<span class="hero-tag">${match}% ${esc(t('match'))}</span>`:''}`;
    $('#heroTitle').textContent = titleOf(it);
    const cert = certificationOf(it);
    $('#heroMeta').innerHTML = `<span class="match">${match?match+'% '+esc(t('match')):esc(t('new'))}</span><span>${year(it.release_date||it.first_air_date)}</span>${cert?`<span class="chip" style="padding:2px 8px">${esc(cert)}</span>`:''}<span>${esc(media==='tv'?t('series'):t('movie'))}</span>${it.vote_average?`<span class="rating">${STAR} ${it.vote_average.toFixed(1)}</span>`:''}`;
    $('#heroDesc').textContent = it.overview || '';
    if (animate) { const hc=$('#heroContent'); hc.classList.remove('hero-anim'); void hc.offsetWidth; hc.classList.add('hero-anim'); }
    $$('#heroDots button').forEach((b,i)=>b.classList.toggle('active', i===state.heroIndex));
    const onList = inWatchlist(it.id, media), listBtn = $('#heroList');
    listBtn.classList.toggle('active', onList); listBtn.innerHTML = onList?CHECK:PLUS;
    listBtn.title = onList ? t('inMyList') : t('addMyList');
    listBtn.onclick = () => toggleWatchlist(it);
    $('#heroPlay').onclick = () => { recordContinue(it); openPlayer({ title: titleOf(it), media, tmdbId: it.id, backdrop: backdropUrl(it.backdrop_path||it.poster_path) }); };
    $('#heroInfo').onclick = () => openDetail(media, it.id, titleOf(it));
  }
  function nextHero() { if(!state.heroItems.length)return; state.heroIndex=(state.heroIndex+1)%state.heroItems.length; renderHero(true); }
  function prevHero() { if(!state.heroItems.length)return; state.heroIndex=(state.heroIndex-1+state.heroItems.length)%state.heroItems.length; renderHero(true); }

  /* ================= NAV ================= */
  function setNav(nav) {
    const hash = (nav||location.hash.replace('#','')||'home').toLowerCase();
    $$('#navLinks a, #mobileMenu a').forEach((a)=>a.classList.toggle('active', a.dataset.nav===hash));
  }
  function hideAllViews() {
    ['#content','#resultsView','#mylistView','#playlistsView','#playlistDetailView','#liveView'].forEach((s)=>$(s).classList.add('hidden'));
  }
  function showHome() {
    hideAllViews(); $('#content').classList.remove('hidden');
    if (!state.homeLoaded) loadHome();
    window.scrollTo({top:0,behavior:'smooth'}); closeMobileMenu();
  }
  function closeMobileMenu() {
    $('#hamburger').classList.remove('open'); $('#mobileMenu').classList.remove('open');
    $('#navbar').classList.remove('menu-open'); $('#hamburger').setAttribute('aria-expanded','false');
  }
  $$('#navLinks a').forEach((a)=>{ a.onclick = (e)=>{ e.preventDefault(); navigate(a.dataset.nav); }; });
  const mm = $('#mobileMenu');
  $$('#navLinks a').forEach((a)=>{
    const b = document.createElement('a'); b.href='#'+a.dataset.nav; b.dataset.nav=a.dataset.nav; b.dataset.i18n=a.dataset.i18n||a.dataset.nav; b.innerHTML = a.innerHTML;
    b.onclick=(e)=>{e.preventDefault(); navigate(a.dataset.nav);}; mm.appendChild(b);
  });
  $$('.footer-links a').forEach((a)=>{ a.onclick=(e)=>{e.preventDefault(); navigate(a.dataset.nav);}; });
  $('#hamburger').onclick = () => {
    const open = $('#hamburger').classList.toggle('open');
    $('#mobileMenu').classList.toggle('open', open); $('#navbar').classList.toggle('menu-open', open);
    $('#hamburger').setAttribute('aria-expanded', open?'true':'false');
  };

  function renderRoute(nav) {
    nav = String(nav || 'home').toLowerCase();
    setNav(nav); closeMobileMenu();
    if (nav==='home') showHome();
    else if (nav==='mylist') showMyList();
    else if (nav==='playlists') showPlaylists();
    else if (nav==='live') showLiveTV();
    else if (nav==='drama') showDrama();
    else if (['movies','tv','anime'].includes(nav)) showResultsForNav(nav);
    else showHome();
  }
  function navigate(nav) {
    const target = '#' + nav;
    if (location.hash === target) renderRoute(nav);
    else location.hash = nav; // hashchange renders exactly once
  }

  function showResultsForNav(nav) {
    hideAllViews(); $('#resultsView').classList.remove('hidden'); $('#searchIntentBanner').classList.add('hidden');
    window.scrollTo({top:0});
    const titles = { movies:t('movies'), tv:t('tvShows'), anime:t('anime') };
    $('#resultsTitle').textContent = titles[nav] || t('browse');
    $('#resultsEmpty').classList.add('hidden'); $('#resultsMore').classList.add('hidden');
    const grid = $('#resultsGrid'); grid.innerHTML = '';
    for (let i=0;i<18;i++){ const s=document.createElement('div'); s.className='skel-card skel'; grid.appendChild(s); }
    state.browse.kind = nav==='anime'?'anime':(nav==='tv'?'tv':'movie'); state.browse.genre = 0; state.browse.page = 1;
    renderGenreChips(nav);
    if (nav==='movies') loadBrowsePage('/movie/popular');
    else if (nav==='tv') loadBrowsePage('/tv/popular');
    else if (nav==='anime') loadBrowsePage('/anime/top', true);
  }

  function showDrama() {
    hideAllViews(); $('#resultsView').classList.remove('hidden'); $('#searchIntentBanner').classList.add('hidden');
    window.scrollTo({top:0});
    $('#resultsTitle').textContent = t('asianDramas');
    $('#genreChips').classList.remove('hidden');
    const wrap = $('#genreChips'); wrap.innerHTML = '';
    const langs = [
      ['ko',t('korean')],['ja',t('japanese')],['zh',t('chinese')],['hi',t('indian')],
      ['tr',t('turkish')],['th',t('thai')],['all',t('allDramas')]
    ];
    let cur = 'ko';
    const mkChip = (code, label, active=false) => {
      const b = document.createElement('button'); b.className='cat-chip'+(active?' active':''); b.textContent=label;
      b.onclick=()=>{ $$('#genreChips .cat-chip').forEach(x=>x.classList.remove('active')); b.classList.add('active'); cur=code; state.browse.page=1; loadDramas(code); };
      wrap.appendChild(b);
    };
    langs.forEach(([c,l],i)=>mkChip(c,l,i===0));
    const grid = $('#resultsGrid'); grid.innerHTML='';
    for (let i=0;i<18;i++){ const s=document.createElement('div'); s.className='skel-card skel'; grid.appendChild(s); }
    loadDramas('ko');
    $('#resultsMore').classList.add('hidden');
  }
  function loadDramas(lang) {
    const grid = $('#resultsGrid');
    grid.innerHTML='';
    for (let i=0;i<18;i++){ const s=document.createElement('div'); s.className='skel-card skel'; grid.appendChild(s); }
    const path = lang==='all' ? '/drama/popular' : `/drama/popular?origin=${lang}`;
    api(path).then((d)=>{
      grid.innerHTML='';
      const items = d.results||[];
      if (!items.length) { $('#resultsEmpty').classList.remove('hidden'); return; }
      $('#resultsEmpty').classList.add('hidden');
      items.forEach((it)=>grid.appendChild(tmdbCard(it)));
    }).catch(()=>{ grid.innerHTML=`<div class="results-empty">${esc(t('couldNotLoad'))}</div>`; });
  }

  function loadBrowsePage(apiPath, isAnime=false, append=false) {
    state.browse.loading=true; state.browse.apiPath=apiPath;
    const grid=$('#resultsGrid');
    if (!append) { grid.innerHTML=''; for (let i=0;i<18;i++){ const s=document.createElement('div'); s.className='skel-card skel'; grid.appendChild(s); } }
    $('#resultsMore').classList.add('hidden');
    api(apiPath + (apiPath.includes('?')?'&':'?') + 'page=' + state.browse.page).then((d)=>{
      if (!append) grid.innerHTML='';
      let items = isAnime ? (d.data||[]) : (d.results||[]);
      items = items.filter(isReleased);
      if (!items.length && !append) { $('#resultsEmpty').classList.remove('hidden'); return; }
      $('#resultsEmpty').classList.add('hidden');
      items.forEach((it)=>grid.appendChild(isAnime?animeCard(it):tmdbCard(it)));
      state.browse.totalPages = Math.min(isAnime ? ((d.pagination&&d.pagination.last_visible_page)||1) : (d.total_pages||1), 20);
      if (state.browse.page < state.browse.totalPages) $('#resultsMore').classList.remove('hidden');
    }).catch(()=>{ if(!append) grid.innerHTML='<div class="results-empty">Could not load. Try again.</div>'; })
     .finally(()=>{ state.browse.loading=false; });
  }
  $('#resultsMore').onclick = () => {
    if (state.browse.loading || !state.browse.apiPath) return;
    state.browse.page++;
    loadBrowsePage(state.browse.apiPath, state.browse.kind==='anime', true);
  };
  $('#resultsBack').onclick = () => navigate('home');

  async function renderGenreChips(nav) {
    const wrap = $('#genreChips'); wrap.innerHTML=''; wrap.classList.remove('hidden');
    const mk = (label, fn, active=false) => {
      const b=document.createElement('button'); b.className='cat-chip'+(active?' active':''); b.textContent=label;
      b.onclick=()=>{ $$('#genreChips .cat-chip').forEach(x=>x.classList.remove('active')); b.classList.add('active'); state.browse.page=1; fn(); };
      wrap.appendChild(b);
    };
    if (nav==='movies'||nav==='tv') {
      const media = nav==='tv'?'tv':'movie'; state.browse.kind=media;
      mk(t('all'), ()=>loadBrowsePage(`/${media}/popular`), true);
      try { const g = await api('/genres?media='+media); (g.genres||[]).forEach((x)=>mk(x.name, ()=>{ state.browse.genre=x.id; loadBrowsePage(`/${media}/genre?g=${x.id}`); })); } catch(e){}
    } else if (nav==='anime') {
      state.browse.kind='anime';
      mk(t('topAll'), ()=>loadBrowsePage('/anime/top', true), true);
      try { const g = await api('/anime/genres'); (g.genres||[]).slice(0,18).forEach((x)=>mk(x.name, ()=>{ state.browse.genre=x; loadBrowsePage(`/anime/genre?g=${x.mal_id}&name=${encodeURIComponent(x.name)}`, true); })); } catch(e){}
    } else wrap.classList.add('hidden');
  }

  /* ================= SMART / DYNAMIC SEARCH ================= */
  const searchWrap=$('#searchWrap'), searchInput=$('#searchInput');
  $('#searchToggle').onclick=()=>{
    searchWrap.classList.toggle('open');
    if(searchWrap.classList.contains('open')) setTimeout(()=>searchInput.focus(),160);
    else { searchInput.value=''; searchController?.abort(); }
  };
  document.addEventListener('click',(event)=>{
    if(!searchWrap.classList.contains('open')) return;
    if(event.target.closest('.search-wrap')||event.target.closest('.search-toggle')) return;
    if(!searchInput.value) searchWrap.classList.remove('open');
  });
  let searchTimer;
  let searchController = null;
  let searchRequestId = 0;
  searchInput.addEventListener('input',(event)=>{
    const query=event.target.value.trim();
    searchWrap.classList.toggle('has-value',!!query);
    clearTimeout(searchTimer);
    if(!query) { searchController?.abort(); return; }
    if (query.length < 2) return;
    searchTimer=setTimeout(()=>doSearch(query),260);
  });
  searchInput.addEventListener('keydown',(event)=>{
    if(event.key==='Enter') doSearch(searchInput.value.trim());
    if(event.key==='Escape'){ searchInput.value=''; searchInput.blur(); searchController?.abort(); }
  });
  $('#searchClear').onclick=()=>{
    searchInput.value=''; searchWrap.classList.remove('has-value'); searchController?.abort(); searchInput.focus();
  };

  function searchMediaType(item) {
    if (item && (item.kind === 'anime' || item.mal_id != null || item.anilist_id != null)) return 'anime';
    return mediaOf(item);
  }
  function renderSearchItems() {
    const grid=$('#resultsGrid'); grid.innerHTML='';
    const filter=state.search.filter || 'all';
    const items=(state.search.items||[]).filter((item)=>filter==='all'||searchMediaType(item)===filter);
    items.forEach((item)=>grid.appendChild(searchMediaType(item)==='anime'?animeCard(item):tmdbCard(item)));
    $('#resultsEmpty').classList.toggle('hidden',items.length>0);
  }
  function renderSearchFilters() {
    const wrap=$('#genreChips'); wrap.innerHTML=''; wrap.classList.remove('hidden');
    const counts={all:state.search.items.length,movie:0,tv:0,anime:0};
    state.search.items.forEach((item)=>{ const kind=searchMediaType(item); if(counts[kind]!=null) counts[kind]++; });
    const options=[['all',t('filterAll')],['movie',t('filterMovies')],['tv',t('filterTV')],['anime',t('filterAnime')]];
    options.forEach(([value,label])=>{
      if(value!=='all'&&!counts[value]) return;
      const button=document.createElement('button');
      button.className='cat-chip'+(state.search.filter===value?' active':'');
      button.textContent=`${label} (${counts[value]})`;
      button.onclick=()=>{ state.search.filter=value; renderSearchFilters(); renderSearchItems(); };
      wrap.appendChild(button);
    });
  }
  function renderSearchIntent(intent) {
    const banner=$('#searchIntentBanner');
    if(!intent){ banner.classList.add('hidden'); banner.innerHTML=''; return; }
    const parts=[];
    if(intent.language_label) parts.push(intent.language_label);
    if(intent.genre_label) parts.push(intent.genre_label);
    if(intent.year) parts.push(intent.year);
    if(intent.sort==='vote_average.desc') parts.push(state.uiLang==='hi'?'टॉप रेटेड':'Top rated');
    if(intent.sort==='date.desc') parts.push(state.uiLang==='hi'?'नया':'Latest');
    const label=parts.join(' · ')||intent.label||state.search.query;
    banner.innerHTML=`<span class="smart-search-icon">✦</span><div><b>${esc(t('smartResults',{label}))}</b><small>${esc(state.uiLang==='hi'?'शैली, भाषा और प्रकार समझकर परिणाम दिखाए गए हैं।':'Matched by genre, language and media type — not just title text.')}</small></div>`;
    banner.classList.remove('hidden');
  }

  async function doSearch(query) {
    if(!query) return;
    searchController?.abort();
    searchController=new AbortController();
    const signal=searchController.signal;
    const requestId=++searchRequestId;
    hideAllViews(); $('#resultsView').classList.remove('hidden');
    $('#resultsMore').classList.add('hidden'); $('#resultsEmpty').classList.add('hidden');
    $('#genreChips').classList.add('hidden'); $('#searchIntentBanner').classList.add('hidden');
    $('#resultsTitle').textContent=t('resultsFor',{query});
    const grid=$('#resultsGrid'); grid.innerHTML='';
    for(let index=0;index<18;index++){const skeleton=document.createElement('div');skeleton.className='skel-card skel';grid.appendChild(skeleton);}
    window.scrollTo({top:0});
    try{
      const catalogue=await api('/search/smart?q='+encodeURIComponent(query),{signal});
      if(requestId!==searchRequestId||signal.aborted)return;
      const intent=catalogue.intent||null;
      let animeItems=[];
      const wantsAnime=!intent||intent.media==='all'||intent.media==='anime';
      if(wantsAnime){
        try{
          let animeData;
          if(intent&&intent.anime_genre_id){
            animeData=await api(`/anime/genre?g=${intent.anime_genre_id}&name=${encodeURIComponent(intent.genre_label||'')}`,{signal});
          }else if(intent&&intent.media==='anime'){
            animeData=await api('/anime/top?page=1',{signal});
          }else{
            animeData=await api('/anime/search?q='+encodeURIComponent(query),{signal});
          }
          animeItems=(animeData.data||[]).slice(0,18).map((item)=>({...item,kind:'anime'}));
        }catch(error){if(error.name==='AbortError')throw error;}
      }
      if(requestId!==searchRequestId||signal.aborted)return;
      const catalogueItems=(catalogue.results||[])
        .filter((item)=>item&&(item.media_type==='movie'||item.media_type==='tv'||item.title||item.name))
        .filter(isReleased).slice(0,40);
      state.search={query,items:[...catalogueItems,...animeItems],filter:intent&&intent.media!=='all'?intent.media:'all',intent};
      // If the requested filter has no items, gracefully show everything.
      if(state.search.filter!=='all'&&!state.search.items.some((item)=>searchMediaType(item)===state.search.filter)) state.search.filter='all';
      renderSearchIntent(intent); renderSearchFilters(); renderSearchItems();
      if(!state.search.items.length){
        grid.innerHTML=`<div class="results-empty">${esc(t('searchFailed'))}</div>`;
        $('#resultsEmpty').classList.add('hidden');
      }
    }catch(error){
      if(error.name!=='AbortError')grid.innerHTML=`<div class="results-empty">${esc(t('searchFailed'))}</div>`;
    }
  }

  /* ================= MY LIST ================= */
  function showMyList() { hideAllViews(); $('#mylistView').classList.remove('hidden'); window.scrollTo({top:0}); closeMobileMenu(); renderMyList(); }
  function renderMyList() {
    const grid=$('#mylistGrid'); grid.innerHTML='';
    if (!state.watchlist.length) { $('#mylistEmpty').classList.remove('hidden'); return; }
    $('#mylistEmpty').classList.add('hidden');
    state.watchlist.forEach((it)=>{
      if (it.media==='anime') {
        grid.appendChild(animeCard({ mal_id:(it.animeSource||'mal')==='mal'?it.id:null, anilist_id:it.animeSource==='anilist'?it.id:null, anime_source:it.animeSource||'mal', title:it.title, title_english:it.title, images:{jpg:{image_url:posterUrl(it.poster)}}, score:it.vote_average, year:year(it.release_date) }));
      } else {
        grid.appendChild(tmdbCard({ id:it.id, media_type:it.media, title:it.title, name:it.title, poster_path:it.poster, backdrop_path:it.backdrop, vote_average:it.vote_average, release_date:it.release_date, first_air_date:it.release_date }));
      }
    });
  }

  /* ================= PLAYLISTS UI ================= */
  function showPlaylists() {
    hideAllViews(); $('#playlistsView').classList.remove('hidden'); window.scrollTo({top:0}); closeMobileMenu(); renderPlaylists();
  }
  function renderPlaylists() {
    loadPlaylists();
    const wrap = $('#playlistsList'); wrap.innerHTML='';
    if (!state.playlists.length) {
      wrap.innerHTML = `<div class="results-empty" style="padding:60px 20px">
        <div style="font-size:40px;margin-bottom:10px">🎬</div>
        <p style="font-size:15px;color:var(--muted)">${esc(t('emptyPlaylists'))}</p>
        <p style="font-size:13px;color:var(--muted-2);margin-top:6px">${esc(t('emptyPlaylistHint'))}</p>
      </div>`;
      return;
    }
    const grid = document.createElement('div'); grid.className='playlists-grid';
    state.playlists.forEach((pl) => {
      const posters = pl.items.slice(0,4).map((it) => posterUrl(it.poster));
      while (posters.length < 4) posters.push(placeholderPoster());
      const card = document.createElement('div'); card.className='playlist-card';
      card.tabIndex=0; card.setAttribute('role','button');
      card.innerHTML = `
        <div class="pl-posters">
          ${posters.map((p,i)=>`<img src="${esc(p)}" alt="" onerror="this.onerror=null;this.src='${placeholderPoster()}'"><span class="pl-grad"></span>`).join('')}
        </div>
        <div class="pl-meta">
          <div class="pl-name">${esc(pl.name)}</div>
          <div class="pl-info">${t(pl.items.length===1?'titlesCount':'titlesCountPlural',{count:pl.items.length})}</div>
        </div>
        <button class="pl-del" title="Delete playlist" aria-label="Delete">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>`;
      card.onclick = (e) => {
        if (e.target.closest('.pl-del')) {
          if (confirm(`Delete playlist "${pl.name}"?`)) { state.playlists = state.playlists.filter(x=>x.id!==pl.id); savePlaylists(); renderPlaylists(); }
          return;
        }
        openPlaylist(pl.id);
      };
      card.onkeydown = (e) => { if(e.key==='Enter'||e.key===' '){e.preventDefault(); openPlaylist(pl.id);} };
      grid.appendChild(card);
    });
    wrap.appendChild(grid);
  }
  function openPlaylist(plId) {
    loadPlaylists();
    const pl = state.playlists.find((p)=>p.id===plId); if (!pl) return;
    hideAllViews(); $('#playlistDetailView').classList.remove('hidden');
    window.scrollTo({top:0});
    $('#plTitle').textContent = pl.name;
    $('#plCount').textContent = `${t(pl.items.length===1?'titlesCount':'titlesCountPlural',{count:pl.items.length})}`;
    const grid = $('#plGrid'); grid.innerHTML='';
    if (!pl.items.length) { $('#plEmpty').classList.remove('hidden'); }
    else {
      $('#plEmpty').classList.add('hidden');
      pl.items.forEach((it)=>{
        if (it.media==='anime') grid.appendChild(animeCard({ mal_id:(it.animeSource||'mal')==='mal'?it.id:null, anilist_id:it.animeSource==='anilist'?it.id:null, anime_source:it.animeSource||'mal', title:it.title, title_english:it.title, images:{jpg:{image_url:posterUrl(it.poster)}}, score:it.vote_average, year:year(it.release_date) }));
        else grid.appendChild(tmdbCard({ id:it.id, media_type:it.media, title:it.title, name:it.title, poster_path:it.poster, backdrop_path:it.backdrop, vote_average:it.vote_average, release_date:it.release_date, first_air_date:it.release_date }));
      });
    }
    $('#plRename').onclick = () => {
      const n = prompt(state.uiLang==='hi'?'प्लेलिस्ट का नया नाम:':'Rename playlist:', pl.name);
      if (n && n.trim()) { pl.name = n.trim(); savePlaylists(); openPlaylist(plId); }
    };
    $('#plBack').onclick = () => showPlaylists();
  }
  $('#createPlaylistBtn').onclick = () => {
    const name = prompt(t('playlistName'), state.uiLang==='hi'?'मेरी प्लेलिस्ट':'My Playlist');
    if (name && name.trim()) { const pl = createPlaylist(name.trim()); openPlaylist(pl.id); }
  };

  /* Add-to-playlist modal from player */
  let pendingPlaylistItem = null;
  function openPlaylistModal(item) {
    pendingPlaylistItem = item;
    loadPlaylists();
    $('#plModalItem').textContent = (item.title||'') + (item.year?` (${item.year})`:'');
    const list = $('#plModalList'); list.innerHTML='';
    if (!state.playlists.length) {
      list.innerHTML = `<div class="tiny-note" style="padding:8px 2px">${esc(state.uiLang==='hi'?'अभी कोई प्लेलिस्ट नहीं है — नीचे नई बनाएँ।':'No playlists yet — create one below.')}</div>`;
    } else {
      state.playlists.forEach((pl) => {
        const has = pl.items.some((x)=>String(x.id)===String(item.id) && x.media===item.media);
        const row = document.createElement('button');
        row.className = 'pl-row' + (has?' in':'');
        row.innerHTML = `<span class="pl-row-name">${esc(pl.name)}</span><span class="pl-row-count">${pl.items.length}</span>${has?'<span class="pl-row-check">✓</span>':''}`;
        row.onclick = () => {
          if (has) { removeFromPlaylist(pl.id, item.id, item.media); }
          else addToPlaylist(pl.id, item);
          openPlaylistModal(item); // refresh
        };
        list.appendChild(row);
      });
    }
    $('#playlistModal').classList.remove('hidden');
    document.body.style.overflow='hidden';
  }
  $('#plModalNew').onclick = () => {
    const name = prompt(t('newPlaylistName'), state.uiLang==='hi'?'मेरी प्लेलिस्ट':'My Playlist');
    if (name && name.trim()) {
      const pl = createPlaylist(name.trim());
      if (pendingPlaylistItem) addToPlaylist(pl.id, pendingPlaylistItem);
      openPlaylistModal(pendingPlaylistItem);
    }
  };
  $('#playlistModalClose').onclick = () => { $('#playlistModal').classList.add('hidden'); if ($('#playerModal').classList.contains('hidden')) document.body.style.overflow=''; };
  $('#playlistModal').addEventListener('click', (e) => { if (e.target.id==='playlistModal') $('#playlistModalClose').click(); });

  /* ================= DETAIL MODAL ================= */
  async function openDetail(media, id, fallbackTitle) {
    showModal();
    const body = $('#modalBody');
    body.innerHTML = '<div class="skel" style="height:220px;border-radius:14px;margin-bottom:90px"></div>';
    try {
      const d = await api('/details?media='+media+'&id='+encodeURIComponent(id));
      state.detail = { media, id: d.id||id, title: d.title||d.name||fallbackTitle };
      renderDetail(d);
    } catch(e) { body.innerHTML=`<div class="section-label" style="color:#ff8690">${esc(t('detailsFailed'))}</div>`; }
  }
  function renderDetail(d) {
    const body=$('#modalBody'), media=state.detail.media, isTv=media==='tv'||!!d.number_of_seasons;
    const genres=(d.genres||[]).map((g)=>`<span class="chip">${esc(g.name)}</span>`).join('');
    const rating = d.vote_average?Number(d.vote_average).toFixed(1):'—';
    const match=matchScore(d), cert=certificationOf({...d,media_type:media});
    const backdrop=backdropUrl(d.backdrop_path||d.poster_path||'');
    const runtime = d.runtime?`<span>${runtimeFmt(d.runtime)}</span>`:'';
    const seasons = d.number_of_seasons?`<span>${d.number_of_seasons} season${d.number_of_seasons>1?'s':''}</span>`:'';
    $('#modalBackdrop').style.backgroundImage = backdrop?`url(${backdrop})`:'none';
    const onList = inWatchlist(d.id, media);
    body.innerHTML = `
      <h2 class="modal-title" id="modalTitle">${esc(d.title||d.name)}</h2>
      <div class="modal-meta">
        ${match?`<span class="match">${match}% Match</span>`:''}
        <span>${year(d.release_date||d.first_air_date)}</span>
        ${String(d.original_language||'').toLowerCase()==='hi'?`<span class="hindi-original-chip">🎧 ${esc(t('hindiOriginal'))}</span>`:''}
        ${cert?`<span class="chip" style="padding:2px 9px">${esc(cert)}</span>`:''}
        ${runtime}${seasons}
        ${d.status?`<span>${esc(d.status)}</span>`:''}
        <span class="rating" style="color:var(--gold);font-weight:800">${STAR} ${rating}</span>
      </div>
      <div class="modal-genres">${genres}</div>
      <p class="modal-desc">${esc(d.overview||t('noSynopsis'))}</p>
      <div class="modal-actions">
        <button class="btn btn-play" id="detailPlay"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> ${esc(t('watchNow'))}</button>
        <button class="btn btn-ghost" id="detailList">${esc(onList?t('inMyList'):t('myList'))}</button>
        <button class="btn btn-ghost" id="detailPlaylist">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M21 15V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h9"/><path d="M3 10h18M8 18h4M8 14h7M19 16v6M16 19h6"/></svg>
          ${esc(t('playlists'))}
        </button>
      </div>
      <div id="detailExtra"></div>`;
    $('#detailPlay').onclick = () => { recordContinue(d); closeModal(); openPlayer({ title:d.title||d.name, media, tmdbId:d.id, backdrop:backdropUrl(d.backdrop_path||d.poster_path) }); };
    $('#detailList').onclick = () => { toggleWatchlist({...d, id:d.id, media_type:media}); const b=$('#detailList'); setTimeout(()=>{ b.textContent=inWatchlist(d.id,media)?t('inMyList'):t('myList'); },0); };
    $('#detailPlaylist').onclick = () => openPlaylistModal({ id:d.id, media, title:d.title||d.name, poster:d.poster_path||'', backdrop:d.backdrop_path||'', vote_average:d.vote_average, release_date:d.release_date||d.first_air_date, year:year(d.release_date||d.first_air_date) });
    renderDetailExtra(d, isTv);
  }
  async function renderDetailExtra(d, isTv) {
    const wrap=$('#detailExtra');
    if (isTv && d.number_of_seasons) {
      const blk = document.createElement('div');
      blk.innerHTML = `<div class="section-label">${esc(t('seasonsEpisodes'))}</div><div class="season-tabs" id="seasonTabs"></div><div class="ep-list" id="epList"></div>`;
      wrap.appendChild(blk);
      const seasonList = (d.seasons||[]).filter(s=>s.season_number>0).sort((a,b)=>a.season_number-b.season_number);
      const tabs=$('#seasonTabs');
      if (!seasonList.length) seasonList.push({season_number:1,name:'Season 1',episode_count:0});
      seasonList.forEach((s)=>{
        const b=document.createElement('button'); b.className='season-tab'+(s.season_number===1?' active':'');
        b.textContent=`Season ${s.season_number}`; b.title=`${s.episode_count||'?'} episodes`;
        b.onclick=()=>{ $$('#seasonTabs .season-tab').forEach(x=>x.classList.remove('active')); b.classList.add('active'); loadEpisodes(d.id, s.season_number); };
        tabs.appendChild(b);
      });
      loadEpisodes(d.id, 1);
    }
    const cast=(d.credits&&d.credits.cast)||[];
    if (cast.length) {
      const c=document.createElement('div');
      c.innerHTML=`<div class="section-label">${esc(t('topCast'))}</div><div class="cast-row" id="castRow"></div>`; wrap.appendChild(c);
      cast.slice(0,12).forEach((p)=>{
        const div=document.createElement('div'); div.className='cast-card';
        div.innerHTML=`<img class="cast-avatar" loading="lazy" src="${p.profile_path?CAST_IMG+p.profile_path:placeholderPoster()}" alt="${esc(p.name)}" onerror="this.onerror=null;this.src='${placeholderPoster()}'"><div class="cast-name">${esc(p.name)}</div><div class="cast-role">${esc(p.character||'')}</div>`;
        $('#castRow').appendChild(div);
      });
    }
    const similar=[...((d.recommendations&&d.recommendations.results)||[]).slice(0,8),...((d.similar&&d.similar.results)||[]).slice(0,8)]
      .filter((v,i,arr)=>arr.findIndex(x=>x.id===v.id)===i).slice(0,12);
    if (similar.length) {
      const s=document.createElement('div');
      s.innerHTML=`<div class="section-label">${esc(t('moreLikeThis'))}</div><div class="mini-row" id="similarRow"></div>`; wrap.appendChild(s);
      similar.forEach((it)=>{
        const div=document.createElement('div'); div.className='mini-card'; div.tabIndex=0;
        div.innerHTML=`<img loading="lazy" src="${esc(posterUrl(it.poster_path))}" alt="${esc(titleOf(it))}" onerror="this.onerror=null;this.src='${placeholderPoster()}'"><div class="mc-title">${esc(titleOf(it))}</div>`;
        const m=mediaOf(it);
        div.onclick=()=>openDetail(m, it.id, titleOf(it));
        div.onkeydown=(e)=>{ if(e.key==='Enter'||e.key===' '){e.preventDefault(); openDetail(m,it.id,titleOf(it));} };
        $('#similarRow').appendChild(div);
      });
    }
  }
  async function loadEpisodes(tvId, seasonNum) {
    const list=$('#epList');
    list.innerHTML=`<div class="row-error" style="border:none;padding:8px"><span>${esc(t('loadingEpisodes'))}</span></div>`;
    try {
      const data = await api(`/tv/season?id=${tvId}&s=${seasonNum}`); list.innerHTML='';
      (data.episodes||[]).forEach((ep)=>{
        const el=document.createElement('div'); el.className='ep'; el.tabIndex=0; el.setAttribute('role','button');
        const still=ep.still_path?`https://image.tmdb.org/t/p/w300${ep.still_path}`:stillPlaceholder();
        el.innerHTML=`<img class="ep-still" loading="lazy" src="${still}" alt="" onerror="this.onerror=null;this.src='${stillPlaceholder()}'"><div class="ep-body"><div class="ep-title">${esc(ep.name||'Episode '+ep.episode_number)}</div><div class="ep-meta"><span>E${ep.episode_number}</span>${ep.air_date?`<span>${year(ep.air_date)}</span>`:''}${ep.vote_average?`<span>${STAR} ${ep.vote_average.toFixed(1)}</span>`:''}${ep.runtime?`<span>${ep.runtime}m</span>`:''}</div><div class="ep-over">${esc(ep.overview||'')}</div></div><div class="ep-play" aria-hidden="true">${PLAY_SM}</div>`;
        const play=()=>{ recordContinue({id:tvId,media_type:'tv',title:state.detail.title,vote_average:0,release_date:''},{season:seasonNum,episode:ep.episode_number}); closeModal(); openPlayer({title:state.detail.title,media:'tv',tmdbId:tvId,backdrop:$('#modalBackdrop').style.backgroundImage.slice(5,-2),season:seasonNum,episode:ep.episode_number}); };
        el.onclick=play;
        el.onkeydown=(e)=>{ if(e.key==='Enter'||e.key===' '){e.preventDefault();play();} };
        list.appendChild(el);
      });
      if (!(data.episodes||[]).length) list.innerHTML=`<div class="row-error" style="border:none"><span>${esc(t('noEpisodeData'))}</span></div>`;
    } catch(e) { list.innerHTML=`<div class="row-error" style="border:none"><span>${esc(t('episodesFailed'))}</span></div>`; }
  }

  async function openAnimeDetail(animeId, img, title, source = 'mal') {
    showModal();
    const bodyEl=$('#modalBody');
    bodyEl.innerHTML='<div class="skel" style="height:220px;border-radius:14px;margin-bottom:90px"></div>';
    try {
      const r = await api(`/anime/details?id=${encodeURIComponent(animeId)}&source=${encodeURIComponent(source)}`);
      const a = r.data || {};
      const ref = animeRef({ ...a, id: animeId, anime_source: a.anime_source || source });
      const aTitle = a.title_english||a.title||title||'Anime';
      const backdrop=a.banner_image||(a.images&&a.images.jpg&&(a.images.jpg.large_image_url||a.images.jpg.image_url))||img||'';
      const genres=(a.genres||[]).map((g)=>`<span class="chip">${esc(g.name)}</span>`).join('');
      const synopsis = String(a.synopsis || t('noSynopsis'))
        .replace(/<br\s*\/?\s*>/gi, ' ')
        .replace(/<[^>]+>/g, '')
        .replace(/\[written by.*?\]/i,'')
        .trim();
      $('#modalBackdrop').style.backgroundImage=backdrop?`url(${backdrop})`:'none';
      const onList=inWatchlist(ref.id,'anime');
      state.detail={media:'anime',id:ref.id,title:aTitle,animeSource:ref.source};
      bodyEl.innerHTML = `
        <h2 class="modal-title" id="modalTitle">${esc(aTitle)}</h2>
        <div class="modal-meta"><span>${esc(t('anime'))}</span><span>${a.year||(a.aired&&a.aired.from?year(a.aired.from):'—')}</span>
          <span class="rating" style="color:var(--gold);font-weight:800">${STAR} ${a.score||'—'}</span>
          <span>${esc(a.type||'TV')}</span>${a.status?`<span>${esc(a.status)}</span>`:''}<span>${a.episodes||'?'} ${esc(t('episodes').toLowerCase())}</span></div>
        <div class="modal-genres">${genres}</div>
        <p class="modal-desc">${esc(synopsis || t('noSynopsis'))}</p>
        <div class="modal-actions">
          <button class="btn btn-play" id="animePlay"><svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> ${esc(t('watchNow'))}</button>
          <button class="btn btn-ghost" id="animeList">${esc(onList?t('inMyList'):t('myList'))}</button>
          ${a.url?`<a class="btn btn-ghost" href="${esc(a.url)}" target="_blank" rel="noopener">${ref.source==='mal'?'MyAnimeList':'AniList'}</a>`:''}
        </div>
        <div id="detailExtra"></div>`;
      const animeItem={
        id:ref.id, media_type:'anime', anime_source:ref.source, title:aTitle, poster_path:backdrop,
        vote_average:Number(a.score)||0, release_date:String(a.year||''),
      };
      $('#animePlay').onclick=()=>{
        recordContinue(animeItem,{ animeSource:ref.source });
        closeModal();
        openPlayer({title:aTitle,media:'anime',animeId:ref.id,animeSource:ref.source,backdrop});
      };
      $('#animeList').onclick=()=>{
        toggleWatchlist(animeItem);
        const b=$('#animeList'); setTimeout(()=>{b.textContent=inWatchlist(ref.id,'anime')?t('inMyList'):t('myList');},0);
      };
    } catch(e) {
      bodyEl.innerHTML=`<div class="section-label" style="color:#ff8690">${esc(t('detailsFailed'))}</div>`;
    }
  }

  /* ============================================================
     STREAMING PLAYER
     ============================================================ */
  function getSource(id) { return STREAM_SOURCES.find(source=>source.id===id) || orderedSources()[0]; }
  function activeSource() {
    const player=state.player;
    if(player.source===AUTO_ID)return orderedSources()[player.autoIdx]||orderedSources()[0];
    return getSource(player.source);
  }
  function buildEmbedUrl(source) {
    const player=state.player, selected=source||activeSource(), id=player.tmdbId;
    const lang=player.audioLang||'';
    const quality=player.quality||'auto';
    return player.media==='movie'
      ? selected.movie(id,lang,player.speed||1,quality)
      : selected.tv(id,player.season||1,player.episode||1,lang,player.speed||1,quality);
  }

  /* ===== Anime direct playback (MAL/AniList id, no TMDB match needed) ===== */
  function activeAnimeSource() {
    const p=state.player;
    const list=animeSourcesFor(p.animeIds,p.animeDub);
    if(!list.length)return null;
    if(p.animeSourceId===AUTO_ID)return list[p.animeAutoIdx]||list[0];
    return list.find((s)=>s.id===p.animeSourceId)||list[0];
  }
  function buildAnimeUrl(source) {
    const p=state.player;
    const selected=source||activeAnimeSource();
    if(!selected)return '';
    return selected.url(p.animeIds,p.animeEpisode||1,p.animeDub);
  }
  function renderAnimeSourceChips() {
    const wrap=$('#sourceChips'); if(!wrap)return;
    const p=state.player;
    wrap.innerHTML='';
    const list=animeSourcesFor(p.animeIds,p.animeDub);
    const mk=(id,label,color,isAuto)=>{
      const b=document.createElement('button');
      b.className='source-chip'+(id===p.animeSourceId?' active':'')+(isAuto?' auto-chip':'');
      b.style.setProperty('--sc',color);
      b.innerHTML=isAuto?`<span class="sc-auto">⚡</span><span>${esc(label)}</span>`
        :`<span class="sc-dot" style="background:${color}"></span>${esc(label)}`;
      b.onclick=()=>{
        p.animeSourceId=id;
        if(id===AUTO_ID)p.animeAutoIdx=0;
        renderAnimeSourceChips(); loadAnimeStream(true);
      };
      wrap.appendChild(b);
    };
    mk(AUTO_ID,t('autoBest'),'#22d3ee',true);
    list.forEach((s)=>mk(s.id,s.name,s.color,false));
  }
  function renderAnimeEpisodeChips() {
    const wrap=$('#epChips'); if(!wrap)return;
    const p=state.player;
    const count=Math.max(1,Number(p.animeEpisodeCount)||1);
    wrap.innerHTML='';
    for(let i=1;i<=count;i++){
      const b=document.createElement('button');
      b.className='ep-chip'+(i===p.animeEpisode?' active':'');
      b.textContent=i; b.title=`${t('episodes')} ${i}`;
      b.onclick=()=>{
        p.animeEpisode=i; renderAnimeEpisodeChips(); loadAnimeStream(true);
        recordContinue({id:p.animeId,media_type:'anime',anime_source:p.animeSource,title:p.title,poster_path:p.backdrop||''},{animeSource:p.animeSource,episode:i});
      };
      wrap.appendChild(b);
    }
    const prev=$('#pcPrev'), next=$('#pcNext');
    if(prev){prev.style.display='';prev.disabled=p.animeEpisode<=1;}
    if(next){next.style.display='';next.disabled=p.animeEpisode>=count;}
  }
  async function tryAnimeSourceAt(idx, token) {
    const p=state.player;
    const list=animeSourcesFor(p.animeIds,p.animeDub);
    if(!p.active||p.loadToken!==token)return false;
    if(idx>=list.length){
      showPlayerLoading(t('serverBusy'));
      $('#plSourceName').textContent=`${t('nextServer')} · ${t('tryAgain')}`;
      $$('.pf-inline-retry').forEach(n=>n.remove());
      const bar=document.createElement('div');
      bar.className='pf-inline-retry';
      bar.innerHTML=`<button class="btn btn-play sm" id="pfAnimeRetry">${esc(t('tryAgain'))}</button>`;
      $('#playerVideoWrap').appendChild(bar);
      $('#pfAnimeRetry').onclick=()=>{bar.remove();loadAnimeStream(true);};
      return false;
    }
    p.animeAutoIdx=idx;
    const source=list[idx];
    showPlayerLoading(`${state.uiLang==='hi'?'कोशिश':'Trying'} ${source.name}… (${idx+1}/${list.length})`);
    const url=buildAnimeUrl(source);
    $('#playerExt').href=url;
    const ok=await setFrameSource(url,token);
    if(!p.active||p.loadToken!==token)return false;
    if(!ok&&p.animeSourceId===AUTO_ID)return tryAnimeSourceAt(idx+1,token);
    if(ok){
      hidePlayerLoading();
      const note=$('#plSourceName');
      note.textContent=`${state.uiLang==='hi'?'चल रहा है':'Playing via'} ${source.name}`;
      setTimeout(()=>{if(!$('#playerLoading').classList.contains('show'))note.textContent='';},2500);
      return true;
    }
    showPlayerLoading(t('tryAgain'));
    return false;
  }
  /* ============================================================
     NATIVE HLS PLAYER
     A third-party iframe cannot be told which resolution or audio track to
     use — the parent page has no reach into another origin's document. The
     only way those controls can genuinely work is to play the stream
     ourselves, so when /api/anime/stream resolves a direct manifest we drive
     a real <video> element and expose its actual HLS levels.
     ============================================================ */
  let nativeHls = null;
  let nativeReqToken = 0;

  function destroyNativePlayer() {
    const video = $('#playerVideo');
    if (nativeHls) { try { nativeHls.destroy(); } catch (e) {} nativeHls = null; }
    if (video) {
      try { video.pause(); } catch (e) {}
      video.removeAttribute('src');
      [...video.querySelectorAll('track')].forEach((n) => n.remove());
      try { video.load(); } catch (e) {}
      video.classList.add('hidden');
    }
    $('#playerSkipIntro')?.classList.add('hidden');
    state.player.nativeActive = false;
    state.player.nativeLevels = [];
    state.player.nativeSkip = null;
    state.player.nativeAudio = [];
    state.player.nativeProvider = '';
  }

  function showNativePlayer() {
    $('#playerFrame')?.classList.add('hidden');
    $('#playerVideo')?.classList.remove('hidden');
    state.player.nativeActive = true;
  }

  function showIframePlayer() {
    destroyNativePlayer();
    $('#playerFrame')?.classList.remove('hidden');
  }

  // Populate #pcQuality from the manifest's real levels and switch on demand.
  function syncNativeQualityOptions() {
    const select = $('#pcQuality');
    const p = state.player;
    if (!select || !p.nativeActive || !nativeHls) return;
    const levels = nativeHls.levels || [];
    p.nativeLevels = levels;
    const previous = select.value;
    select.innerHTML = '';
    const auto = document.createElement('option');
    auto.value = 'auto'; auto.textContent = t('qualityAuto') || 'Auto';
    select.appendChild(auto);
    levels.forEach((level, index) => {
      const opt = document.createElement('option');
      opt.value = 'lvl:' + index;
      const height = level.height || 0;
      const rate = level.bitrate ? ` · ${Math.round(level.bitrate / 1000)}kbps` : '';
      opt.textContent = height ? `${height}p${rate}` : `Level ${index + 1}${rate}`;
      select.appendChild(opt);
    });
    // Honour a saved cap by picking the closest level at or below it.
    if (previous && previous.startsWith('lvl:') && levels[Number(previous.slice(4))]) {
      select.value = previous;
    } else {
      const cap = parseInt(state.quality, 10);
      if (Number.isFinite(cap) && levels.length) {
        let best = -1;
        levels.forEach((level, index) => {
          if ((level.height || 0) <= cap && (best < 0 || (level.height || 0) > (levels[best].height || 0))) best = index;
        });
        if (best >= 0) { select.value = 'lvl:' + best; nativeHls.currentLevel = best; }
        else select.value = 'auto';
      } else select.value = 'auto';
    }
    const control = $('#pcQualityControl');
    if (control) {
      control.classList.remove('ctl-unsupported');
      control.removeAttribute('data-note');
      // Be honest when the upstream master advertises a single rendition: the
      // menu genuinely has nothing to switch between, so say so instead of
      // leaving a dead-looking dropdown the user keeps poking at.
      if (levels.length <= 1) {
        const only = levels[0] && levels[0].height ? `${levels[0].height}p` : 'source';
        control.setAttribute('data-note', t('qualitySingle') || `Source provides ${only} only`);
        select.title = t('qualitySingle') || `This episode is served at ${only} only`;
      } else {
        select.title = t('qualityReal') || 'Direct stream — quality really switches';
      }
    }
    select.disabled = levels.length <= 1;
  }

  function applyNativeQuality(value) {
    if (!nativeHls) return false;
    if (value === 'auto') { nativeHls.currentLevel = -1; return true; }
    if (String(value).startsWith('lvl:')) {
      const index = Number(String(value).slice(4));
      if (nativeHls.levels && nativeHls.levels[index]) { nativeHls.currentLevel = index; return true; }
    }
    return false;
  }

  // ---------------------------------------------------------------------
  // Native multi-audio (AnimeWorld/Zephyrix masters carry Hindi, Tamil,
  // Telugu, Bengali, Malayalam, English and Japanese as separate HLS audio
  // renditions). hls.js can hot-swap them without reloading the video, so the
  // language dropdown becomes instant instead of a stream restart.
  // ---------------------------------------------------------------------
  const AUDIO_LANG_ALIASES = {
    hin: 'hi', hi: 'hi', eng: 'en', en: 'en', jpn: 'ja', jp: 'ja', ja: 'ja',
    tam: 'ta', ta: 'ta', tel: 'te', te: 'te', ben: 'bn', bn: 'bn',
    mal: 'ml', ml: 'ml', kan: 'kn', kn: 'kn', mar: 'mr', mr: 'mr',
    guj: 'gu', gu: 'gu', pan: 'pa', pa: 'pa', urd: 'ur', ur: 'ur',
    kor: 'ko', ko: 'ko', zho: 'zh', chi: 'zh', zh: 'zh', spa: 'es', es: 'es',
    fra: 'fr', fre: 'fr', fr: 'fr', deu: 'de', ger: 'de', de: 'de',
    por: 'pt', pt: 'pt', ara: 'ar', ar: 'ar', rus: 'ru', ru: 'ru',
  };
  const AUDIO_LANG_LABELS = {
    hi: 'हिन्दी / Hindi', en: 'English', ja: '日本語 / Japanese', ta: 'தமிழ் / Tamil',
    te: 'తెలుగు / Telugu', bn: 'বাংলা / Bengali', ml: 'മലയാളം / Malayalam',
    kn: 'ಕನ್ನಡ / Kannada', mr: 'मराठी / Marathi', gu: 'ગુજરાતી / Gujarati',
    pa: 'ਪੰਜਾਬੀ / Punjabi', ur: 'اردو / Urdu', ko: 'Korean', zh: 'Chinese',
    es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese', ar: 'Arabic', ru: 'Russian',
  };
  // Normalise whatever the manifest says ("hin", "hi-IN", "Hindi") to a 2-letter code.
  function normalizeAudioLang(raw) {
    const value = String(raw || '').trim().toLowerCase();
    if (!value) return '';
    const base = value.split(/[-_]/)[0];
    if (AUDIO_LANG_ALIASES[base]) return AUDIO_LANG_ALIASES[base];
    if (base.length === 2) return base;
    return '';
  }
  function audioTrackLabel(track, index) {
    const code = normalizeAudioLang(track && (track.lang || track.language));
    if (code && AUDIO_LANG_LABELS[code]) return AUDIO_LANG_LABELS[code];
    const name = String((track && (track.name || track.label)) || '').trim();
    if (name) return name;
    return code ? code.toUpperCase() : `Audio ${index + 1}`;
  }

  // Fill #pcAnimeAudio with the manifest's real audio renditions. Falls back to
  // the legacy SUB/DUB selector (handled by syncAnimeAudioControl) when the
  // stream is single-audio, so nothing regresses on the old provider.
  function syncNativeAudioTracks() {
    const p = state.player;
    const select = $('#pcAnimeAudio');
    const control = $('#pcAnimeAudioControl');
    if (!select || !nativeHls) return false;
    const tracks = nativeHls.audioTracks || [];
    if (tracks.length <= 1) { p.nativeAudio = []; return false; }
    p.nativeAudio = tracks.map((track, index) => ({
      index, lang: normalizeAudioLang(track.lang || track.language),
      label: audioTrackLabel(track, index),
    }));
    select.innerHTML = '';
    p.nativeAudio.forEach((track) => {
      const opt = document.createElement('option');
      opt.value = 'aud:' + track.index;
      opt.textContent = track.label;
      select.appendChild(opt);
    });
    select.disabled = false;
    control?.classList.remove('hidden', 'anime-hidden', 'ctl-unsupported');
    control?.setAttribute('data-note', state.uiLang === 'hi'
      ? `${p.nativeAudio.length} भाषाएँ उपलब्ध`
      : `${p.nativeAudio.length} languages available`);

    // Pick the user's saved language if this episode actually has it, else the
    // site language, else English, else whatever came first.
    const saved = localStorage.getItem('sv-audio-lang') || p.audioLang || '';
    const wanted = [saved, state.uiLang === 'hi' ? 'hi' : '', 'en']
      .map(normalizeAudioLang).filter(Boolean);
    let chosen = -1;
    for (const code of wanted) {
      const hit = p.nativeAudio.find((track) => track.lang === code);
      if (hit) { chosen = hit.index; break; }
    }
    if (chosen < 0) chosen = Number.isInteger(nativeHls.audioTrack) && nativeHls.audioTrack >= 0
      ? nativeHls.audioTrack : p.nativeAudio[0].index;
    select.value = 'aud:' + chosen;
    applyNativeAudioTrack('aud:' + chosen, true);
    const status = $('#audioTrackStatus');
    if (status) {
      const active = p.nativeAudio.find((track) => track.index === chosen);
      status.className = 'audio-track-status confirmed';
      status.textContent = '✓ ' + (active ? active.label.split(' / ')[0] : 'AUDIO');
    }
    return true;
  }

  // Switch the live audio rendition. hls.js keeps the video buffer, so the
  // picture never stops — only the voice changes.
  function applyNativeAudioTrack(value, silent) {
    const p = state.player;
    if (!nativeHls || !String(value).startsWith('aud:')) return false;
    const index = Number(String(value).slice(4));
    const track = (p.nativeAudio || []).find((item) => item.index === index);
    if (!track) return false;
    try { nativeHls.audioTrack = index; } catch (e) { return false; }
    if (track.lang) {
      p.audioLang = track.lang;
      localStorage.setItem('sv-audio-lang', track.lang);
      // Keep the SUB/DUB memory sensible: anything that isn't Japanese is a dub.
      p.animeDub = track.lang !== 'ja';
      localStorage.setItem('sv-anime-dub', p.animeDub ? '1' : '0');
    }
    const status = $('#audioTrackStatus');
    if (status) {
      status.className = 'audio-track-status confirmed';
      status.textContent = '✓ ' + track.label.split(' / ')[0];
    }
    if (!silent) {
      toast((state.uiLang === 'hi' ? 'ऑडियो: ' : 'Audio: ') + track.label);
    }
    return true;
  }

  function syncNativeSubtitleOptions(tracks) {
    const control = $('#pcSubtitleControl');
    const select = $('#pcSubtitle');
    if (!control || !select) return;
    const list = tracks || [];
    select.innerHTML = '';
    const off = document.createElement('option');
    off.value = 'off'; off.textContent = t('subtitlesOff') || 'Off';
    select.appendChild(off);
    list.forEach((track, index) => {
      const opt = document.createElement('option');
      opt.value = String(index); opt.textContent = track.label || `Track ${index + 1}`;
      select.appendChild(opt);
    });
    control.classList.toggle('hidden', !list.length);
    const preferred = list.findIndex((track) => track.default);
    select.value = preferred >= 0 ? String(preferred) : 'off';
    applyNativeSubtitle(select.value);
  }

  function applyNativeSubtitle(value) {
    const video = $('#playerVideo');
    if (!video) return;
    const tracks = video.textTracks || [];
    for (let i = 0; i < tracks.length; i++) {
      tracks[i].mode = (value !== 'off' && String(i) === String(value)) ? 'showing' : 'disabled';
    }
  }

  function wireSkipIntro() {
    const video = $('#playerVideo');
    const button = $('#playerSkipIntro');
    if (!video || !button) return;
    button.onclick = () => {
      const skip = state.player.nativeSkip;
      if (skip && Number.isFinite(skip.end)) video.currentTime = skip.end + 0.2;
      button.classList.add('hidden');
    };
  }

  // Resolve a direct anime stream; returns false so callers can fall back to
  // the iframe providers when no host has the episode.
  async function tryNativeAnimeStream(token, showLoad) {
    const p = state.player;
    const ids = p.animeIds || {};
    const useAnilist = !ids.mal && !!ids.anilist;
    const id = useAnilist ? ids.anilist : (ids.mal || p.animeId);
    if (!id) return false;
    const request = ++nativeReqToken;
    if (showLoad) showPlayerLoading(t('nativePlayer') || 'Direct stream');
    let data;
    try {
      // The title lets the server try AnimeWorld first (multi-audio: Hindi,
      // Tamil, Telugu… plus 240p-1080p). It falls back to the id-based
      // provider on its own, so sending it can only help.
      const response = await fetch(`/api/anime/stream?id=${encodeURIComponent(id)}` +
        `&source=${useAnilist ? 'anilist' : 'mal'}&ep=${encodeURIComponent(p.animeEpisode || 1)}` +
        `&lang=${p.animeDub ? 'dub' : 'sub'}` +
        `&title=${encodeURIComponent(p.title || '')}`, { headers: { Accept: 'application/json' } });
      if (!response.ok) return false;
      data = await response.json();
    } catch (e) { return false; }
    if (!data || !data.ok || !data.source) return false;
    if (!p.active || p.loadToken !== token || request !== nativeReqToken) return false;

    let Hls;
    try { Hls = await ensureHls(); } catch (e) { return false; }
    if (!p.active || p.loadToken !== token || request !== nativeReqToken) return false;

    const video = $('#playerVideo');
    if (!video) return false;
    destroyNativePlayer();
    showNativePlayer();

    // Subtitle tracks ride along as real <track> elements.
    (data.tracks || []).forEach((track, index) => {
      const el = document.createElement('track');
      el.kind = 'subtitles'; el.label = track.label || `Track ${index + 1}`;
      el.src = track.file; if (track.default) el.default = true;
      video.appendChild(el);
    });
    p.nativeSkip = data.intro || null;
    video.playbackRate = Number(p.speed) || 1;

    const started = await new Promise((resolve) => {
      let settled = false;
      const done = (ok) => { if (!settled) { settled = true; resolve(ok); } };
      const guard = window.setTimeout(() => done(false), 15000);
      const finish = (ok) => { window.clearTimeout(guard); done(ok); };

      if (Hls.isSupported()) {
        nativeHls = new Hls({
          maxBufferLength: 30,
          maxMaxBufferLength: 90,
          capLevelToPlayerSize: false,
          startLevel: -1,
          fragLoadingMaxRetry: 4,
          manifestLoadingMaxRetry: 3,
        });
        nativeHls.on(Hls.Events.MANIFEST_PARSED, () => {
          syncNativeQualityOptions();
          syncNativeAudioTracks();
          finish(true);
        });
        // Some masters expose their audio group slightly after the manifest.
        if (Hls.Events.AUDIO_TRACKS_UPDATED) {
          nativeHls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => syncNativeAudioTracks());
        }
        nativeHls.on(Hls.Events.LEVEL_SWITCHED, () => updateNativeQualityBadge());
        nativeHls.on(Hls.Events.ERROR, (evt, info) => {
          if (!info || !info.fatal) return;
          if (info.type === Hls.ErrorTypes.NETWORK_ERROR) { try { nativeHls.startLoad(); return; } catch (e) {} }
          if (info.type === Hls.ErrorTypes.MEDIA_ERROR) { try { nativeHls.recoverMediaError(); return; } catch (e) {} }
          finish(false);
        });
        nativeHls.attachMedia(video);
        nativeHls.loadSource(data.source);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Safari plays HLS natively; levels are managed by the OS.
        video.src = data.source;
        video.addEventListener('loadedmetadata', () => finish(true), { once: true });
        video.addEventListener('error', () => finish(false), { once: true });
      } else finish(false);
    });

    if (!started || !p.active || p.loadToken !== token || request !== nativeReqToken) {
      if (!started) showIframePlayer();
      return started && p.active;
    }

    syncNativeSubtitleOptions(data.tracks || []);
    p.nativeProvider = data.provider || '';
    const multi = syncNativeAudioTracks();
    if (!multi) syncAnimeAudioControl();
    wireSkipIntro();
    hidePlayerLoading();
    try { await video.play(); } catch (e) { /* autoplay policy: user taps play */ }
    const badge = $('#plSourceName');
    if (badge) badge.textContent = '';
    const extra = multi
      ? ` · ${(p.nativeAudio || []).length} ${state.uiLang === 'hi' ? 'भाषाएँ' : 'languages'}`
      : '';
    toast(`${t('nativePlayer') || 'Direct stream'} · ${data.provider}${extra}`);
    return true;
  }

  function updateNativeQualityBadge() {
    const p = state.player;
    if (!p.nativeActive || !nativeHls) return;
    const select = $('#pcQuality');
    if (select && select.value === 'auto' && nativeHls.currentLevel >= 0) {
      const level = (nativeHls.levels || [])[nativeHls.currentLevel];
      const control = $('#pcQualityControl');
      if (control && level) control.setAttribute('data-note', `Auto → ${level.height || '?'}p`);
    }
  }

  function watchNativeSkip() {
    const video = $('#playerVideo');
    if (!video) return;
    video.addEventListener('timeupdate', () => {
      const p = state.player;
      const button = $('#playerSkipIntro');
      if (!button || !p.nativeActive) return;
      const skip = p.nativeSkip;
      if (!skip || !Number.isFinite(skip.start)) { button.classList.add('hidden'); return; }
      const now = video.currentTime;
      button.classList.toggle('hidden', !(now >= skip.start && now < skip.end));
    });
  }

  function loadAnimeStream(showLoad=true) {
    const p=state.player;
    if(!p.active||!p.animeDirect)return;
    const token=++p.loadToken;
    $$('.pf-inline-retry, .player-fallback').forEach(n=>n.remove());
    applyFramePolicy();
    $('#playerTitle').textContent=`${p.title} — ${state.uiLang==='hi'?'एपिसोड':'Episode'} ${p.animeEpisode}`;
    // Prefer the native path: it is the only one where quality / audio /
    // subtitles are genuinely under our control.
    tryNativeAnimeStream(token, showLoad).then((ok) => {
      if (ok || !p.active || p.loadToken !== token) return;
      showIframePlayer();
      const list=animeSourcesFor(p.animeIds,p.animeDub);
      if(!list.length){renderAnimeFallback(p.title,p.animeId,null,p.animeSource);return;}
      if(p.animeSourceId===AUTO_ID){p.animeAutoIdx=0;tryAnimeSourceAt(0,token);return;}
      const source=activeAnimeSource();
      if(showLoad)showPlayerLoading(source.name);
      setFrameSource(buildAnimeUrl(source),token).then((ok2)=>{
        if(!p.active||p.loadToken!==token)return;
        if(!ok2){p.animeSourceId=AUTO_ID;renderAnimeSourceChips();tryAnimeSourceAt(0,++p.loadToken);}
        else hidePlayerLoading();
      });
    });
  }
  function updateAudioTrackStatus() {
    const status=$('#audioTrackStatus'); if(!status)return;
    const player=state.player, source=activeSource();
    status.className='audio-track-status';
    if(player.originalLanguage==='hi'){
      status.textContent='✓ '+t('hindiOriginal'); status.classList.add('confirmed');
    }else if(player.audioLang==='hi'){
      status.classList.add('requested');
      status.innerHTML=`<span>◉ ${esc(t('hindiRequested'))}</span>${source&&source.audioRequest?'':`<button type="button" class="try-hindi-source">${esc(t('tryHindiSource'))}</button>`}`;
      status.title=t('audioNotGuaranteed');
      const button=status.querySelector('.try-hindi-source');
      if(button)button.onclick=()=>{
        // Pick the highest-priority *reachable* source that documents an audio
        // preference. peachify is offline, so never hard-code it here.
        const target=orderedSources(true).find((s)=>s.audioRequest&&s.auto!==false)
          ||STREAM_SOURCES.find((s)=>s.id==='videasy')
          ||STREAM_SOURCES.find((s)=>s.id==='vidfast');
        if(!target){toast(t('audioUnavailable')||'No audio-capable server available');return;}
        player.source=target.id; player.autoIdx=0;
        renderSourceChips(); loadStream(true);
        toast(`${target.name}`);
      };
    }else status.textContent='';
  }
  function postPlayerSpeed(speed) {
    const frame=$('#playerFrame'); if(!frame||!frame.contentWindow)return;
    const value=Number(speed)||1;
    const messages=[
      {action:'setSpeed',value},
      {type:'PLAYER_COMMAND',command:'setSpeed',value},
      {type:'SET_SPEED',speed:value},
      {event:'setPlaybackRate',value},
    ];
    messages.forEach((message)=>{try{frame.contentWindow.postMessage(message,'*');}catch(error){}});
    try{frame.contentWindow.postMessage(JSON.stringify({event:'command',func:'setPlaybackRate',args:[value]}),'*');}catch(error){}
  }
  function schedulePlaybackSpeed() {
    const source=activeSource();
    if(state.player.media==='anime'||(source&&source.remoteSpeed)){
      [350,1100,2400].forEach((delay)=>window.setTimeout(()=>{
        if(state.player.active)postPlayerSpeed(state.player.speed);
      },delay));
    }
  }
  function showPlayerLoading(text) {
    const el=$('#playerLoading'); el.classList.add('show');
    $('#plSourceName').textContent = text || (state.player.source===AUTO_ID ? t('pickingServer') : activeSource().name);
  }
  function hidePlayerLoading() { $('#playerLoading').classList.remove('show'); }

  function renderSourceChips() {
    const wrap=$('#sourceChips'); wrap.innerHTML='';
    const mkChip = (id, label, color, isAuto) => {
      const b=document.createElement('button');
      b.className='source-chip'+(id===state.player.source?' active':'')+(isAuto?' auto-chip':'');
      b.style.setProperty('--sc', color);
      b.innerHTML = isAuto
        ? `<span class="sc-auto">⚡</span><span>${esc(label)}</span>`
        : `<span class="sc-dot" style="background:${color}"></span>${esc(label)}`;
      b.onclick=()=>{
        state.player.source=id;
        if (id===AUTO_ID) state.player.autoIdx=0;
        localStorage.setItem('sv-source', id);
        renderSourceChips(); updateAudioTrackStatus();
        loadStream(true);
      };
      wrap.appendChild(b);
    };
    mkChip(AUTO_ID, t('autoBest'), '#22d3ee', true);
    orderedSources(true).forEach((source)=>mkChip(source.id, `${source.audioRequest?'🎧 ':''}${source.qualitySelect?'🎚 ':''}${source.remoteSpeed||source.nativeSpeed?'⏩ ':''}${source.name}`, source.color, false));
    updateQualityControlState();
  }

  // The quality picker is only meaningful on providers that accept a cap.
  // Rather than leaving a dead control on screen, mark it clearly.
  function updateQualityControlState() {
    const wrap = $('#pcQualityControl');
    const select = $('#pcQuality');
    if (!wrap || !select) return;
    // Native playback: the control is fully functional, driven by real levels.
    if (state.player.nativeActive && nativeHls) {
      wrap.classList.remove('anime-hidden');
      // syncNativeQualityOptions() owns the enabled/disabled + note state: it
      // knows how many renditions the master actually advertises.
      syncNativeQualityOptions();
      return;
    }
    if (state.player.media === 'anime') { wrap.classList.add('anime-hidden'); return; }
    wrap.classList.remove('anime-hidden');
    const source = activeSource();
    // Auto can always move to a quality-capable provider, so treat it as capable.
    const capable = !source || source.id === AUTO_ID || Boolean(source.qualitySelect)
      || orderedSources().some((s) => s.qualitySelect);
    wrap.classList.toggle('ctl-unsupported', !capable);
    select.disabled = !capable;
    const note = capable ? '' : (state.uiLang === 'hi'
      ? 'यह सर्वर क्वालिटी चुनने की सुविधा नहीं देता।'
      : 'This server does not support quality selection.');
    select.title = note || (state.uiLang === 'hi'
      ? 'क्वालिटी कैप; सपोर्ट न होने पर प्लेयर ऑटो चलाएगा।'
      : 'Quality cap; the player falls back to Auto if unsupported.');
    wrap.dataset.note = note;
  }

  function setFrameSource(url, token) {
    return new Promise((resolve) => {
      const frame = $('#playerFrame');
      let settled = false;
      let watchdog;
      const done = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        if (frame.onload === onLoad) frame.onload = null;
        if (frame.onerror === onError) frame.onerror = null;
        resolve(Boolean(ok));
      };
      const onLoad = () => {
        if (!state.player.active || state.player.loadToken !== token) return done(false);
        // Cross-origin frames do not expose playback state. A completed frame
        // navigation is the reliable browser signal; the user can still use
        // Next server if the provider itself reports an unavailable title.
        window.setTimeout(() => done(true), 350);
      };
      const onError = () => done(false);

      frame.onload = null;
      frame.onerror = null;
      frame.src = 'about:blank';
      window.setTimeout(() => {
        if (!state.player.active || state.player.loadToken !== token) return done(false);
        frame.onload = onLoad;
        frame.onerror = onError;
        watchdog = window.setTimeout(() => done(false), 8000);
        frame.dataset.sourceId=activeSource().id;
        frame.src = url;
      }, 45);
    });
  }

  async function trySourceAtIndex(idx, token) {
    const p = state.player;
    const list = orderedSources();
    if (!p.active || p.loadToken !== token) return false;
    if (idx >= list.length) {
      showPlayerLoading(t('serverBusy'));
      $('#plSourceName').textContent = `${t('nextServer')} · ${t('tryAgain')}`;
      $$('.pf-inline-retry').forEach(n => n.remove());
      const bar = document.createElement('div');
      bar.className = 'pf-inline-retry';
      bar.innerHTML = `<button class="btn btn-play sm" id="pfInlineRetry">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>
          ${esc(t('tryAgain'))}
        </button>`;
      $('#playerVideoWrap').appendChild(bar);
      $('#pfInlineRetry').onclick = () => {
        bar.remove();
        loadStream(true);
      };
      return false;
    }
    p.autoIdx = idx;
    const source = list[idx];
    showPlayerLoading(`${state.uiLang === 'hi' ? 'कोशिश' : 'Trying'} ${source.name}… (${idx+1}/${list.length})`);
    const url = buildEmbedUrl(source);
    $('#playerExt').href = url;
    p._lastSrcAt = Date.now();
    const ok = await setFrameSource(url, token);
    if (!p.active || p.loadToken !== token) return false;
    if (!ok && p.source === AUTO_ID) return trySourceAtIndex(idx + 1, token);
    if (ok) {
      hidePlayerLoading(); updateAudioTrackStatus(); schedulePlaybackSpeed();
      if (p.source === AUTO_ID) {
        const note = $('#plSourceName');
        note.textContent = `${state.uiLang === 'hi' ? 'चल रहा है' : 'Playing via'} ${source.name}`;
        setTimeout(() => { if (!$('#playerLoading').classList.contains('show')) note.textContent = ''; }, 2500);
      }
    }
    return ok;
  }

  function loadStream(showLoad=true) {
    const p = state.player;
    if (!p.active) return;
    if (p.media === 'anime') { if (p.animeDirect) loadAnimeStream(showLoad); return; }
    clearTimeout(p.autoTimer);
    const token = ++p.loadToken;
    $$('.pf-inline-retry, .player-fallback').forEach(n => n.remove());
    applyFramePolicy();
    $('#playerTitle').textContent = p.media==='tv'
      ? `${p.title} — S${String(p.season).padStart(2,'0')}E${String(p.episode).padStart(2,'0')}`
      : p.title;
    updatePrevNext();
    if (p.source === AUTO_ID) {
      p.autoIdx = 0;
      trySourceAtIndex(0, token);
      return;
    }
    const source = activeSource();
    if (showLoad) showPlayerLoading(source.name);
    setFrameSource(buildEmbedUrl(source), token).then((ok) => {
      if (!p.active || p.loadToken !== token) return;
      if (!ok) {
        p.source = AUTO_ID;
        renderSourceChips();
        const nextToken = ++p.loadToken;
        trySourceAtIndex(0, nextToken);
      } else { hidePlayerLoading(); updateAudioTrackStatus(); schedulePlaybackSpeed(); }
    });
  }

  function updatePrevNext() {
    const p=state.player, isTv=p.media==='tv';
    const prev=$('#pcPrev'), next=$('#pcNext');
    if (!isTv) { prev.style.display='none'; next.style.display='none'; return; }
    prev.style.display=''; next.style.display='';
    const eps=p.episodes||[], idx=eps.findIndex(e=>e.episode_number===p.episode);
    prev.disabled = p.episode<=1 && !eps[idx-1];
    next.disabled = idx>=eps.length-1 && !(p.seasons||[]).some(s=>s.season_number===p.season+1);
  }
  function renderEpisodeChips() {
    const wrap=$('#epChips'); wrap.innerHTML='';
    state.player.episodes.forEach((ep)=>{
      const b=document.createElement('button'); b.className='ep-chip'+(ep.episode_number===state.player.episode?' active':'');
      b.textContent=ep.episode_number; b.title=ep.name||`Episode ${ep.episode_number}`;
      b.onclick=()=>{
        state.player.episode=ep.episode_number; renderEpisodeChips(); loadStream();
        recordContinue({id:state.player.tmdbId,media_type:'tv',title:state.player.title,vote_average:0,release_date:''},{season:state.player.season,episode:ep.episode_number});
      };
      wrap.appendChild(b);
    });
  }
  function renderSeasonSelect() {
    const sel=$('#pcSeason'); sel.innerHTML='';
    state.player.seasons.forEach((s)=>{
      const o=document.createElement('option'); o.value=s.season_number;
      o.textContent=s.name||`Season ${s.season_number}`;
      if (s.season_number===state.player.season) o.selected=true;
      sel.appendChild(o);
    });
    sel.onchange=async()=>{ state.player.season=parseInt(sel.value,10); state.player.episode=1; await loadPlayerEpisodes(); renderEpisodeChips(); loadStream(); };
  }
  async function loadPlayerEpisodes() {
    const p=state.player; if (p.media!=='tv') return;
    try {
      const data = await api(`/tv/season?id=${p.tmdbId}&s=${p.season}`,{noCache:true});
      p.episodes=(data.episodes||[]).filter(e=>e.episode_number>0);
      if (!p.episodes.some(e=>e.episode_number===p.episode)) p.episode=1;
    } catch(e) {
      p.episodes=Array.from({length:24},(_,i)=>({episode_number:i+1,name:`Episode ${i+1}`}));
    }
  }
  function populateAudioLanguages(detail) {
    const select = $('#pcLang');
    if (!select) return;
    state.player.originalLanguage = String(detail && detail.original_language || '').toLowerCase();
    if (state.player.originalLanguage === 'hi' && !state.player.audioLang) {
      state.player.audioLang = 'hi';
      localStorage.setItem('sv-audio-lang','hi');
    }
    const found = [];
    const add = (code, label, preference = false) => {
      code = String(code || '').toLowerCase().slice(0, 2);
      if (!code || found.some((x) => x.code === code)) return;
      found.push({ code, label: label || AUDIO_NAMES[code] || code.toUpperCase(), preference });
    };
    // TMDB lists original/spoken languages, not every dubbed audio track.
    // Keep those real metadata values and expose Hindi as a clearly labelled
    // provider preference rather than falsely claiming that every title has it.
    add(detail && detail.original_language, AUDIO_NAMES[detail && detail.original_language]);
    (detail && detail.spoken_languages || []).forEach((x) => add(x.iso_639_1, x.english_name || AUDIO_NAMES[x.iso_639_1]));
    add('hi', t('hindiPreferred'), true);
    add('en', 'English (when provider offers it)', true);
    select.innerHTML = `<option value="">${esc(t('preferredAudioAuto'))}</option>` + found.map((x) => `<option value="${esc(x.code)}">${esc(x.label)}</option>`).join('');
    const allowed = new Set(found.map((x) => x.code));
    if (!allowed.has(state.player.audioLang)) state.player.audioLang = '';
    select.value = state.player.audioLang;
    select.title = t('audioNote');
    renderPlayerLanguageOptions(); updateAudioTrackStatus();
  }

  function renderPlayerLanguageOptions() {
    const select = $('#pcLang');
    const wrap = $('#playerLanguageOptions');
    const btn = $('#playerAudioBtn');
    if (!select || !wrap || !btn) return;
    wrap.innerHTML = '';
    Array.from(select.options).forEach((option) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'player-language-option' + (option.value === select.value ? ' active' : '');
      item.innerHTML = `<span>${option.value ? '◉' : '◌'}</span><b>${esc(option.textContent)}</b>${option.value === select.value ? '<i>✓</i>' : ''}`;
      item.onclick = () => {
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        $('#playerLanguagePop').classList.add('hidden');
        renderPlayerLanguageOptions();
      };
      wrap.appendChild(item);
    });
    const selected = select.options[select.selectedIndex];
    btn.textContent = select.value ? String(selected && selected.textContent || '').replace(/\s*\(.*?\)/, '').slice(0, 4) : t('audio');
    btn.title = select.value ? `${t('preferredAudio')}: ${selected.textContent}` : t('preferredAudio');
  }

  async function loadPlayerLanguages() {
    const p = state.player;
    if (p.media === 'anime' || !p.tmdbId) return;
    try {
      const d = await api(`/details?media=${p.media}&id=${encodeURIComponent(p.tmdbId)}`, { noCache: true });
      p.details = d;
      populateAudioLanguages(d);
      return d;
    } catch (e) {
      populateAudioLanguages({});
      return null;
    }
  }

  async function loadPlayerSeasons() {
    const p=state.player;
    try {
      const d = await api(`/details?media=tv&id=${p.tmdbId}`);
      p.details = d;
      populateAudioLanguages(d);
      p.seasons=((d.seasons||[]).filter(s=>s.season_number>0).sort((a,b)=>a.season_number-b.season_number));
      if (!p.seasons.length) p.seasons=[{season_number:1,name:'Season 1'}];
    } catch(e) { p.seasons=[{season_number:1,name:'Season 1'}]; }
  }
  async function loadOfficialProviders() {
    const grid=$('#pcProviderGrid'); grid.innerHTML='';
    const p=state.player;
    if (p.media === 'anime' || !p.tmdbId) return;
    try {
      const region=(state.country||state.region||'IN').toUpperCase();
      const r=await api(`/watch?media=${p.media}&id=${encodeURIComponent(p.tmdbId)}&region=${region}`,{noCache:true});
      const regions=r.results||{}, prov=regions[region]||regions.IN||regions.US||Object.values(regions)[0];
      if (!prov) { grid.innerHTML='<div class="tiny-note" style="padding:6px 2px">No official services found for your region.</div>'; return; }
      const services=[]; const push=(arr,tag)=>(arr||[]).forEach(s=>services.push({name:s.provider_name,logo:s.logo_path?'https://image.tmdb.org/t/p/original'+s.logo_path:'',url:prov.link||'#',tag}));
      push(prov.flatrate,'Subscription'); push(prov.free,'Free'); push(prov.ads,'With ads'); push(prov.rent,'Rent'); push(prov.buy,'Buy');
      const seen={}; const list=services.filter(s=>(seen[s.name]?false:(seen[s.name]=true))).slice(0,14);
      list.forEach((s)=>{
        const a=document.createElement('a'); a.className='provider-tile'+(s.tag==='Subscription'?' flatrate':'');
        a.href=s.url; a.target='_blank'; a.rel='noopener';
        const logo=s.logo?`<img src="${esc(s.logo)}" alt="" onerror="this.style.display='none'">`:`<div class="pt-fallback">${esc(s.name[0]||'P')}</div>`;
        a.innerHTML=`${logo}<span class="pt-name">${esc(s.name)}</span><span class="pt-tag">${esc(s.tag)}</span><span class="pt-arrow">›</span>`;
        grid.appendChild(a);
      });
    } catch(e) { grid.innerHTML='<div class="tiny-note" style="padding:6px 2px">Official options unavailable right now.</div>'; }
  }

  async function openPlayer({title, media, tmdbId, animeId, malId, animeSource='mal', backdrop, season=1, episode=1}) {
    const p = state.player;
    p.session = (p.session || 0) + 1;
    const session = p.session;
    p.active = true;
    p.title = title || t('nowPlaying');
    p.backdrop = backdrop || '';
    p.season = season;
    p.episode = episode;
    p.episodes = [];
    p.seasons = [];
    p.animeVideo = null; p.originalLanguage=''; p.audioConfirmed=false; p.isMappedAnime=false;
    p.media = media; p.catalogueMedia=media;
    p.tmdbId = tmdbId || null;
    p.animeId = animeId || malId || null;
    p.animeSource = animeSource === 'anilist' ? 'anilist' : 'mal';
    p.malId = p.animeSource === 'mal' ? p.animeId : null;

    $('#playerModal').classList.remove('hidden');
    if ($('#pcSpeed')) $('#pcSpeed').value=String(p.speed||1); updateVoiceBoostButton();
    document.body.style.overflow = 'hidden';
    resetPlayerFeed();
    $('#playerTitle').textContent = p.title;
    $$('.player-fallback, .pf-inline-retry').forEach((n) => n.remove());
    restoreEpisodePanel();
    restoreMoviePlayerChrome();
    showPlayerLoading(t('preparing'));

    const requestedAnime=media==='anime';
    if(requestedAnime){
      if(!p.animeId){renderAnimeFallback(p.title,null,null,p.animeSource);return;}
      p.animeDirect=false;
      p.animeIds={mal:null,anilist:null};
      p.animeEpisode=Math.max(1,Number(episode)||1);
      p.animeEpisodeCount=0;
      p.animeAutoIdx=0;
      $('#plSourceName').textContent=state.uiLang==='hi'?'ऐनिमे सर्वर तैयार हो रहे हैं…':'Preparing anime servers…';

      // Resolve BOTH ids so every anime provider can be used, then stream the
      // episode directly. A TMDB match is now only an optional extra.
      let details=null;
      try{
        const r=await api(`/anime/details?id=${encodeURIComponent(p.animeId)}&source=${encodeURIComponent(p.animeSource)}`);
        details=r&&r.data||null;
      }catch(error){ details=null; }
      if(!p.active||p.session!==session)return;

      p.animeIds={
        mal: Number(details&&details.mal_id)||(p.animeSource==='mal'?Number(p.animeId):null)||null,
        anilist: Number(details&&details.anilist_id)||(p.animeSource==='anilist'?Number(p.animeId):null)||null,
      };
      p.animeEpisodeCount=Math.max(Number(details&&details.episodes)||0,1);
      if(details&&(details.title_english||details.title))p.title=details.title_english||details.title||p.title;
      $('#playerTitle').textContent=p.title;

      if(animeSourcesFor(p.animeIds,p.animeDub).length||animeSourcesFor(p.animeIds,!p.animeDub).length){
        p.animeDirect=true;
        p.media='anime'; p.catalogueMedia='anime';
        setupAnimePlayerChrome();
        renderAnimeSourceChips();
        renderAnimeEpisodeChips();
        loadAnimeStream(true);
        loadAnimeRecommendations(p);
        clearTimeout(p._loadTimer);
        return;
      }

      // No anime provider usable — fall back to a TMDB mapping if one exists.
      try{
        const mapped=await api(`/anime/tmdb?id=${encodeURIComponent(p.animeId)}&source=${encodeURIComponent(p.animeSource)}`);
        if(!p.active||p.session!==session)return;
        if(!mapped||!mapped.tmdb_id)throw new Error('no playable mapping');
        p.media=mapped.media==='movie'?'movie':'tv'; p.tmdbId=mapped.tmdb_id;
        p.isMappedAnime=true;
      }catch(error){
        if(!p.active||p.session!==session)return;
        renderAnimeFallback(p.title,p.animeId,null,p.animeSource);
        loadAnimeRecommendations(p);
        return;
      }
    }

    renderSourceChips();
    if (p.media === 'tv') {
      $('#pcEpisodes').classList.remove('hidden');
      await loadPlayerSeasons();
      if (!p.active || p.session !== session) return;
      if (!p.seasons.some((s) => s.season_number === p.season)) p.season = p.seasons[0].season_number;
      renderSeasonSelect();
      await loadPlayerEpisodes();
      if (!p.active || p.session !== session) return;
      renderEpisodeChips();
    } else {
      $('#pcEpisodes').classList.add('hidden');
    }

    updatePrevNext();
    if (p.media === 'movie') await loadPlayerLanguages();
    loadStream(true);
    loadOfficialProviders();
    if(requestedAnime)loadAnimeRecommendations(p);else loadRecommendations(p);
    clearTimeout(p._loadTimer);
    p._loadTimer = setTimeout(() => { if (p.active) hidePlayerLoading(); }, 10000);
    clearTimeout(p._muteTimer);
    p._muteTimer = setTimeout(showUnmutePrompt, 3500);
  }

  function resetPlayerFeed() {
    const feed = $('#playerFeed');
    if (feed) {
      feed.scrollTop = 0;
      feed.classList.remove('has-scrolled');
    }
    const hint = $('#feedSwipeHint');
    if (hint) hint.classList.remove('dismissed');
    const inline = $('#playerInlineRecommendations');
    if (inline) inline.classList.add('hidden');
    const inlineRow = $('#playerInlineRecRow');
    if (inlineRow) inlineRow.innerHTML = '';
    $('#playerStage')?.classList.remove('has-inline-recs');
    $('#playerLanguagePop')?.classList.add('hidden');
  }

  function applyFramePolicy() {
    const frame = $('#playerFrame');
    if (state.sandbox) {
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-presentation allow-pointer-lock');
    } else {
      frame.removeAttribute('sandbox');
    }
  }

  // Keeps the dropdown, the SUB/DUB pills and the status badge in agreement.
  function syncAnimeAudioControl() {
    const p = state.player;
    const sel = $('#pcAnimeAudio');
    // A real multi-audio stream owns the dropdown; don't stomp its language
    // list back down to SUB/DUB.
    if (p.nativeActive && (p.nativeAudio || []).length > 1) return;
    if (sel) {
      // Restore the SUB/DUB pair if a previous multi-audio episode replaced it.
      if (!sel.querySelector('option[value="sub"]')) {
        sel.innerHTML = `<option value="sub">${esc(t('animeSub') || 'Subbed (original)')}</option>` +
          `<option value="dub">${esc(t('animeDub') || 'Dubbed')}</option>`;
        sel.disabled = false;
        $('#pcAnimeAudioControl')?.removeAttribute('data-note');
      }
      sel.value = p.animeDub ? 'dub' : 'sub';
      const hasDub = animeSourcesFor(p.animeIds || {}, true).length > 0;
      const dubOpt = sel.querySelector('option[value="dub"]');
      if (dubOpt) {
        dubOpt.disabled = !hasDub;
        dubOpt.textContent = hasDub ? t('animeDub') : t('animeDubUnavailable');
      }
    }
    document.querySelectorAll('.anime-dub-toggle .dub-opt').forEach((b) => {
      b.classList.toggle('active', (b.dataset.dub === 'dub') === Boolean(p.animeDub));
    });
    const status = $('#audioTrackStatus');
    if (status) {
      status.className = 'audio-track-status confirmed';
      status.textContent = p.animeDub ? '✓ DUB' : '✓ SUB';
    }
  }

  // Single code path for changing anime audio, used by the dropdown and pills.
  function setAnimeDub(wantDub) {
    const p = state.player;
    wantDub = Boolean(wantDub);
    if (wantDub === Boolean(p.animeDub)) return;
    if (!animeSourcesFor(p.animeIds || {}, wantDub).length) {
      toast(state.uiLang === 'hi' ? 'इस टाइटल के लिए डब उपलब्ध नहीं है।' : 'No dub available for this title.');
      syncAnimeAudioControl();
      return;
    }
    p.animeDub = wantDub;
    localStorage.setItem('sv-anime-dub', wantDub ? '1' : '0');
    p.animeAutoIdx = 0; p.animeSourceId = AUTO_ID;
    syncAnimeAudioControl();
    renderAnimeSourceChips();
    loadAnimeStream(true);
    toast(wantDub
      ? (state.uiLang === 'hi' ? 'डब ऑडियो चालू' : 'Dubbed audio')
      : (state.uiLang === 'hi' ? 'सब ऑडियो चालू' : 'Subbed audio'));
  }

  // Anime uses its own servers/episodes; show a Sub/Dub switch instead of the
  // TMDB "preferred audio" list, which anime providers do not accept.
  function setupAnimePlayerChrome() {
    const p=state.player;
    const sourceRow=$('#sourceChips')&&$('#sourceChips').closest('.pc-row');
    if(sourceRow)sourceRow.classList.remove('anime-hidden');
    $('#pcEpisodes').classList.remove('hidden');
    // TMDB's spoken-language list means nothing to anime providers, so swap the
    // "Preferred audio" picker for a real SUB/DUB selector in the same slot.
    $('#pcAudioControl').classList.add('anime-hidden');
    $('#pcAnimeAudioControl')?.classList.remove('hidden', 'anime-hidden');
    syncAnimeAudioControl();
    // Quality stays visible for anime: the native path drives real HLS levels.
    // updateQualityControlState() dims it only if we end up on an iframe.
    $('#pcQualityControl')?.classList.remove('anime-hidden');
    $('#audioTrackStatus').classList.remove('anime-hidden');
    $('#playerNextSrc').classList.remove('anime-hidden');
    restoreEpisodePanel();
    const label=$('#pcEpisodes .pc-label');
    if(label){
      const sel=label.querySelector('#pcSeason');
      if(sel)sel.remove();
      if(!label.querySelector('.anime-dub-toggle')){
        const box=document.createElement('div');
        box.className='anime-dub-toggle';
        box.innerHTML=`<button type="button" class="dub-opt${!p.animeDub?' active':''}" data-dub="sub">SUB</button>
          <button type="button" class="dub-opt${p.animeDub?' active':''}" data-dub="dub">DUB</button>`;
        box.querySelectorAll('.dub-opt').forEach((btn)=>{
          btn.onclick=()=>setAnimeDub(btn.dataset.dub==='dub');
        });
        label.appendChild(box);
      }
    }
    syncAnimeAudioControl();
  }

  function restoreMoviePlayerChrome() {
    destroyNativePlayer();
    $('#pcSubtitleControl')?.classList.add('hidden');
    const sourceRow = $('#sourceChips') && $('#sourceChips').closest('.pc-row');
    if (sourceRow) sourceRow.classList.remove('anime-hidden');
    $('#pcAudioControl').classList.remove('anime-hidden'); $('#audioTrackStatus').classList.remove('anime-hidden');
    $('#pcAnimeAudioControl')?.classList.add('hidden');
    $('#pcQualityControl')?.classList.remove('anime-hidden');
    $('#playerAudioBtn').classList.remove('anime-hidden');
    $('#playerLanguagePop').classList.add('hidden');
    renderPlayerLanguageOptions();
    $('#playerNextSrc').classList.remove('anime-hidden');
    const details = $('#pcProviderGrid') && $('#pcProviderGrid').closest('details');
    if (details) {
      details.open = false;
      const summary = details.querySelector('summary');
      if (summary) summary.textContent = 'Official streaming options (Netflix, Prime, JioHotstar…)';
    }
  }

  function restoreEpisodePanel() {
    $('#pcEpisodes').innerHTML = `
      <div class="pc-label">
        <span>${esc(t('episodes'))}</span>
        <select id="pcSeason" class="pc-select" aria-label="Season"></select>
      </div>
      <div class="ep-chips" id="epChips"></div>`;
    $('#pcEpisodes').classList.add('hidden');
  }

  function renderOfficialAnimeLinks(data) {
    const grid = $('#pcProviderGrid');
    const details = grid.closest('details');
    grid.innerHTML = '';
    if (details) {
      details.open = true;
      const summary = details.querySelector('summary');
      if (summary) summary.textContent = t('officialAnimeLinks');
    }
    const providerLinks=(data&&data.official||[]).filter((item)=>item&&item.url&&!/youtube/i.test(item.name||''));
    const episodeLinks = (data && data.episodes || []).filter((x) => x && x.url).slice(0, 8).map((x, i) => ({
      name: x.title || `Episode ${i + 1} · ${x.site || 'Official'}`, url: x.url,
    }));
    const seen = new Set();
    const links = [...providerLinks, ...episodeLinks].filter((item) => {
      if (seen.has(item.url)) return false;
      seen.add(item.url); return true;
    });
    if (!links.length) {
      grid.innerHTML = `<div class="tiny-note" style="padding:6px 2px">${esc(t('officialOptionsUnavailable'))}</div>`;
      return;
    }
    links.forEach((item) => {
      const a = document.createElement('a');
      a.className = 'provider-tile';
      a.href = item.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.innerHTML = `<div class="pt-fallback">${esc((item.name || 'O')[0])}</div><span class="pt-name">${esc(item.name || 'Official source')}</span><span class="pt-arrow">›</span>`;
      grid.appendChild(a);
    });
  }

  const isAnimeItem = (it) => it && (it.kind === 'anime' || it.mal_id != null || it.anilist_id != null || it.media_type === 'anime');

  function playRecommendationItem(it) {
    const isAnime = isAnimeItem(it);
    const name = titleOf(it);
    const poster = isAnime
      ? (it.images && it.images.jpg && (it.images.jpg.large_image_url || it.images.jpg.image_url))
      : it.poster_path;
    if (isAnime) {
      const ref = animeRef(it);
      const item = { id: ref.id, media_type: 'anime', anime_source: ref.source, title: name, vote_average: it.score, release_date: String(it.year || ''), poster_path: poster || '' };
      recordContinue(item, { animeSource: ref.source });
      openPlayer({ title: name, media: 'anime', animeId: ref.id, animeSource: ref.source, backdrop: poster || '' });
    } else {
      const media = mediaOf(it);
      recordContinue({ id: it.id, media_type: media, title: name, vote_average: it.vote_average, release_date: it.release_date || it.first_air_date, poster_path: it.poster_path, backdrop_path: it.backdrop_path });
      openPlayer({ title: name, media, tmdbId: it.id, backdrop: backdropUrl(it.backdrop_path || it.poster_path) });
    }
  }

  function recommendationPoster(it) {
    const isAnime = isAnimeItem(it);
    return isAnime
      ? (it.images && it.images.jpg && (it.images.jpg.large_image_url || it.images.jpg.image_url))
      : posterUrl(it.poster_path);
  }

  function recommendationThumb(it) {
    const isAnime = isAnimeItem(it);
    if (isAnime) return (it.images && it.images.jpg && (it.images.jpg.large_image_url || it.images.jpg.image_url)) || placeholderPoster();
    return it.backdrop_path ? backdropUrl(it.backdrop_path) : posterUrl(it.poster_path);
  }

  function recommendationName(it) {
    return titleOf(it) || 'Recommended title';
  }
  function recommendationReason(item) {
    const reason=String(item&&item.recommendation_reason||'');
    if(state.uiLang!=='hi')return reason;
    if(/Hindi/i.test(reason))return 'इसी शैली के और हिन्दी शीर्षक';
    if(/Similar/i.test(reason))return 'मिलती-जुलती कहानी और शैली';
    if(/anime viewers|Related anime/i.test(reason))return 'ऐनिमे दर्शकों की पसंद';
    if(/same genres|Recommended/i.test(reason))return 'आपके लिए चुना गया';
    return reason;
  }

  // User preference: recommendations can be hidden entirely while watching.
  const recsHidden = () => localStorage.getItem('sv-hide-recs') === '1';
  function setRecsHidden(hidden) {
    localStorage.setItem('sv-hide-recs', hidden ? '1' : '0');
    if (hidden) {
      $('#playerInlineRecommendations')?.classList.add('hidden');
      $('#playerStage')?.classList.remove('has-inline-recs');
      $('#pcRecRow')?.classList.add('hidden');
    } else if (state.player.active) {
      // Re-fetch so the rows repopulate immediately instead of after a reload.
      loadRecommendations(state.player);
    }
    // The "show" affordance only appears once recommendations are hidden.
    $('#pcRecShowRow')?.classList.toggle('hidden', !hidden || !state.player.active);
    const setSel = $('#setShowRecs');
    if (setSel) setSel.value = hidden ? '0' : '1';
  }

  // Recommendations are never drawn on top of the video any more. The floating
  // "NEXT UP" dock covered the picture and the player's own controls, so the
  // whole strip now lives below the player only (#pcRecRow).
  const INLINE_RECS_OVER_VIDEO = false;

  function renderInlineRecommendationCards(items) {
    const wrap = $('#playerInlineRecommendations');
    const row = $('#playerInlineRecRow');
    const stage = $('#playerStage');
    if (!wrap || !row) return;
    row.innerHTML = '';
    if (!INLINE_RECS_OVER_VIDEO) {
      wrap.classList.add('hidden');
      stage?.classList.remove('has-inline-recs');
      return;
    }
    const clean = (recsHidden() ? [] : (items || [])).filter(Boolean).slice(0, 7);
    if (!clean.length) {
      wrap.classList.add('hidden');
      stage.classList.remove('has-inline-recs');
      return;
    }
    clean.forEach((it) => {
      const isAnime = isAnimeItem(it);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'inline-rec-card';
      card.title = [recommendationName(it),recommendationReason(it)].filter(Boolean).join(' — ');
      card.innerHTML = `<img loading="lazy" src="${esc(recommendationThumb(it) || placeholderPoster())}" alt="${esc(recommendationName(it))}" onerror="this.onerror=null;this.src='${placeholderPoster()}'"><span class="inline-rec-name">${esc(recommendationName(it))}</span><span class="inline-rec-type">${isAnime ? 'Anime' : mediaOf(it) === 'tv' ? 'TV' : 'Movie'}</span>`;
      card.onclick = () => playRecommendationItem(it);
      row.appendChild(card);
    });
    wrap.classList.remove('hidden');
    stage.classList.add('has-inline-recs');
  }

  function renderRecommendationCards(items) {
    const inner = $('#pcRecRowInner');
    inner.innerHTML = '';
    const clean = (items || []).filter(Boolean).slice(0, 14);
    if (!clean.length) {
      // Never leave a silently-hidden empty row: the user reads that as
      // "recommendations are broken". Say what happened and offer a retry.
      if (recsHidden()) {
        $('#pcRecRow').classList.add('hidden');
      } else {
        const msg = document.createElement('div');
        msg.className = 'anime-empty';
        msg.textContent = state.uiLang === 'hi'
          ? 'अभी सुझाव नहीं मिल पाए।'
          : 'No recommendations available right now.';
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'lc-btn';
        retry.style.marginTop = '8px';
        retry.textContent = state.uiLang === 'hi' ? 'फिर कोशिश करें' : 'Retry';
        retry.onclick = () => { if (state.player.active) loadRecommendations(state.player); };
        inner.appendChild(msg);
        inner.appendChild(retry);
        $('#pcRecRow').classList.remove('hidden');
      }
      renderInlineRecommendationCards([]);
      return;
    }
    clean.forEach((it) => {
      const isAnime = isAnimeItem(it);
      const c = document.createElement('div');
      c.className = 'rec-card'; c.tabIndex = 0;
      const reason=recommendationReason(it);
      c.innerHTML=`<img loading="lazy" src="${esc(recommendationPoster(it)||placeholderPoster())}" alt="${esc(recommendationName(it))}" onerror="this.onerror=null;this.src='${placeholderPoster()}'"><div class="rec-name">${esc(recommendationName(it))}</div><div class="rec-type">${esc(reason||(isAnime?'Anime':mediaOf(it)==='tv'?'TV show':'Movie'))}</div>`;
      c.onclick = () => playRecommendationItem(it);
      c.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); c.click(); } };
      inner.appendChild(c);
    });
    $('#pcRecRow').classList.toggle('hidden', recsHidden());
    renderInlineRecommendationCards(clean);
  }

  function fallbackRecommendations(p) {
    return (state.heroItems || []).filter((it) => !(p.media === 'anime' && isAnimeItem(it) && animeRef(it).id === Number(p.animeId))).slice(0, 10);
  }

  async function loadRecommendations(p) {
    $('#pcRecRow').classList.add('hidden');
    $('#pcRecRowInner').innerHTML = '';
    renderInlineRecommendationCards([]);
    if (!p.tmdbId || p.media === 'anime') return;
    const session = p.session;
    try {
      const d = await api(`/recommendations?media=${p.media}&id=${p.tmdbId}`);
      if (p.session !== session || !p.active) return;
      const recs = (d.results || [])
        .filter((v, i, arr) => arr.findIndex((x) => x.id === v.id) === i)
        .filter(isReleased)
        .slice(0, 14);
      renderRecommendationCards(recs.length ? recs : fallbackRecommendations(p));
    } catch (e) {
      if (p.session === session && p.active) renderRecommendationCards(fallbackRecommendations(p));
    }
  }

  async function loadAnimeRecommendations(p) {
    $('#pcRecRow').classList.add('hidden');
    $('#pcRecRowInner').innerHTML=''; renderInlineRecommendationCards([]);
    const session=p.session;
    try{
      const recommendationResult=await api(`/anime/recommendations?id=${encodeURIComponent(p.animeId)}&source=${encodeURIComponent(p.animeSource)}`);
      if(p.session!==session||!p.active)return;
      let anime=(recommendationResult.data||[]).filter(Boolean).map((item)=>({...item,kind:'anime'}));
      if(anime.length<8){
        const fallback=await api('/anime/top?page=1');
        if(p.session!==session||!p.active)return;
        anime=[...anime,...(fallback.data||[]).map((item)=>({...item,kind:'anime',recommendation_reason:item.recommendation_reason||'Popular with anime viewers'}))];
      }
      const seen=new Set();
      const recs=anime.filter((item)=>{
        const ref=animeRef(item); const key=ref.source+':'+ref.id;
        if(ref.id===Number(p.animeId)||seen.has(key))return false;
        seen.add(key);return true;
      }).slice(0,16);
      renderRecommendationCards(recs.length?recs:fallbackRecommendations(p));
    }catch(error){
      if(p.session===session&&p.active)renderRecommendationCards(fallbackRecommendations(p));
    }
  }

  function renderAnimeFallback(title, animeId, data, animeSource = 'mal') {
    hidePlayerLoading();
    const sourceRow = $('#sourceChips').closest('.pc-row');
    sourceRow.classList.add('anime-hidden');
    $('#pcAudioControl').classList.add('anime-hidden'); $('#audioTrackStatus').classList.add('anime-hidden');
    $('#playerAudioBtn').classList.add('anime-hidden');
    $('#playerLanguagePop').classList.add('hidden');
    $('#playerNextSrc').classList.add('anime-hidden');
    const frame = $('#playerFrame'); frame.src = 'about:blank';
    $('#playerTitle').textContent = title || t('anime');
    $('#pcEpisodes').classList.toggle('hidden', !(data && data.episodes && data.episodes.length));
    $$('.player-fallback').forEach((n) => n.remove());
    const wrap = document.createElement('div'); wrap.className = 'player-fallback';
    const defaultLinks = [
      { name: 'Crunchyroll', url: `https://www.crunchyroll.com/search?q=${encodeURIComponent(title || 'anime')}` },
      { name: 'Netflix', url: `https://www.netflix.com/search?q=${encodeURIComponent(title || 'anime')}` },
    ];
    const official = ((data && data.official && data.official.length) ? data.official : defaultLinks).filter((x) => x && x.url).slice(0, 4);
    const catalogueUrl = animeSource === 'anilist'
      ? `https://anilist.co/anime/${encodeURIComponent(animeId)}`
      : `https://myanimelist.net/anime/${encodeURIComponent(animeId)}`;
    wrap.innerHTML = `<div class="pf-logo">${PLAY_SM}</div>
      <div class="pf-h">${esc(t('officialUnavailable'))}</div>
      <div class="pf-sub">${esc(t('animeUnavailableHelp'))}</div>
      <div class="pf-btns">
        ${official.map((x) => `<a class="btn btn-more" href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a>`).join('')}
        ${animeId ? `<a class="btn btn-ghost" href="${catalogueUrl}" target="_blank" rel="noopener">${animeSource==='anilist'?'AniList':'MyAnimeList'}</a>` : ''}
      </div>`;
    $('#playerVideoWrap').appendChild(wrap);
    renderOfficialAnimeLinks({ official });
  }
  $('#playerClose').onclick=closePlayer;
  function closePlayer() {
    const p = state.player;
    p.active = false;
    p.loadToken++;
    clearTimeout(p._loadTimer);
    clearTimeout(p._muteTimer);
    const frame = $('#playerFrame');
    frame.onload = null; frame.onerror = null; frame.src = 'about:blank';
    destroyNativePlayer();
    frame.classList.remove('hidden');
    $('#pcSubtitleControl')?.classList.add('hidden');
    $('#playerModal').classList.add('hidden');
    document.body.style.overflow = $('#detailModal').classList.contains('hidden') ? '' : 'hidden';
    hidePlayerLoading();
    $('#unmuteBanner').classList.remove('show');
    $$('.player-fallback, .pf-inline-retry').forEach((n) => n.remove());
    $('#pcRecRow').classList.add('hidden');
    $('#pcRecRowInner').innerHTML = '';
    resetPlayerFeed();
    restoreMoviePlayerChrome();
    p.animeVideo = null;
  }

  const TRUSTED_PLAYER_ORIGINS=new Set([
    'https://apiplayer.ru','https://vidcore.org','https://www.vidcore.org',
    'https://www.youtube-nocookie.com','https://megaplay.buzz','https://vidlink.pro',
    'https://player.videasy.to','https://vidfast.vc','https://vidsrc.cc','https://vidsrc.to','https://vidsrc.su',
  ]);
  window.addEventListener('message',(event)=>{
    const frame=$('#playerFrame');
    if(!state.player.active||!frame||event.source!==frame.contentWindow||!TRUSTED_PLAYER_ORIGINS.has(event.origin))return;
    let payload=event.data;
    if(typeof payload==='string'){try{payload=JSON.parse(payload);}catch(error){return;}}
    if(!payload||typeof payload!=='object')return;
    if(payload.type==='PLAYER_EVENT'&&payload.data){
      const data=payload.data;
      if(data.event==='play'||data.event==='loadedmetadata')schedulePlaybackSpeed();
      updateCurrentProgress(Number(data.currentTime),Number(data.duration));
    }else if(payload.type==='MEDIA_DATA'&&payload.data){
      const current=payload.data[String(state.player.tmdbId)]||payload.data[state.player.tmdbId];
      const progress=current&&current.progress;
      if(progress)updateCurrentProgress(Number(progress.watched),Number(progress.duration));
    }else if(payload.event==='ready'||payload.type==='ready')schedulePlaybackSpeed();
  });

  // Browser autoplay policy: videos start muted. Show tap-to-unmute banner
  // and try to unmute the iframe via a fresh load with user gesture.
  function showUnmutePrompt() {
    const p = state.player;
    if (!p.active) return;
    $('#unmuteBanner').classList.add('show');
  }
  $('#unmuteBtn').onclick = () => {
    const frame = $('#playerFrame');
    // Some provider builds listen for one of these command shapes. They are
    // harmless when ignored, and the native speaker control remains usable.
    try {
      frame.contentWindow.postMessage({ type: 'PLAYER_COMMAND', command: 'unmute' }, '*');
      frame.contentWindow.postMessage({ type: 'UNMUTE' }, '*');
      frame.contentWindow.postMessage({ action: 'unmute' }, '*');
      frame.contentWindow.focus();
    } catch(e) {}
    $('#unmuteBanner').classList.remove('show');
    toast(state.uiLang==='hi'?'आवाज़ बंद हो तो वीडियो के स्पीकर आइकन को दबाएँ।':'If sound is still muted, tap the speaker icon inside the video.');
  };

  // Language / audio selector
  $('#pcLang').value = state.player.audioLang || '';
  $('#pcLang').onchange = (event) => {
    state.player.audioLang=event.target.value;
    localStorage.setItem('sv-audio-lang',event.target.value);
    renderPlayerLanguageOptions(); updateAudioTrackStatus(); renderSourceChips();
    if(state.player.media!=='anime'){
      // Re-run Auto ranking so Hindi originals prefer original-audio sources.
      state.player.autoIdx=0;
      loadStream(true);
    }
    const selected=event.target.options[event.target.selectedIndex];
    toast(event.target.value?t('audioPreference',{language:selected?.textContent||event.target.value.toUpperCase()}):t('audioDefault'));
  };
  // Anime audio (SUB/DUB) — sits where "Preferred audio" is for movies/TV.
  const animeAudioSelect=$('#pcAnimeAudio');
  if(animeAudioSelect){
    animeAudioSelect.onchange=(event)=>{
      const raw=event.target.value;
      // Real multi-audio stream: swap the HLS rendition instantly, no reload.
      if(String(raw).startsWith('aud:')){
        if(!applyNativeAudioTrack(raw)){
          toast(state.uiLang==='hi'?'यह ऑडियो ट्रैक लोड नहीं हो सका।':'That audio track could not be loaded.');
        }
        return;
      }
      // Legacy single-audio provider: SUB/DUB means a fresh stream request.
      setAnimeDub(raw==='dub');
    };
  }
  // Subtitle selector (native playback only).
  const subtitleSelect=$('#pcSubtitle');
  if(subtitleSelect){
    subtitleSelect.onchange=(event)=>{
      applyNativeSubtitle(event.target.value);
      const label=event.target.selectedOptions[0]?.textContent||'';
      toast((state.uiLang==='hi'?'सबटाइटल: ':'Subtitles: ')+label);
    };
  }
  watchNativeSkip();
  // Quality selector — reloads the stream so the provider honours the new cap.
  const qualitySelect=$('#pcQuality');
  if(qualitySelect){
    qualitySelect.value=state.player.quality||'auto';
    qualitySelect.onchange=(event)=>{
      const raw=event.target.value;
      // Native path: switch the actual HLS level. No reload, instant effect.
      if(state.player.nativeActive&&nativeHls){
        if(applyNativeQuality(raw)){
          if(raw==='auto'){
            localStorage.setItem('sv-quality','auto'); state.player.quality='auto';
            toast(state.uiLang==='hi'?'क्वालिटी: ऑटो':'Quality: Auto');
          }else{
            const level=(nativeHls.levels||[])[Number(String(raw).slice(4))];
            const height=level&&level.height?level.height:null;
            if(height){localStorage.setItem('sv-quality',String(height));state.player.quality=String(height);}
            toast((state.uiLang==='hi'?'क्वालिटी: ':'Quality: ')+(height?height+'p':'set'));
          }
          updateQualityControlState();
        }
        return;
      }
      const value=QUALITY_VALUES.includes(raw)?raw:'auto';
      state.player.quality=value;
      localStorage.setItem('sv-quality',value);
      const source=activeSource();
      if(state.player.media==='anime'){
        toast(state.uiLang==='hi'?'ऐनिमे प्लेयर में क्वालिटी वीडियो के अंदर चुनें।':'For anime, pick quality inside the video player.');
        return;
      }
      if(source&&!source.qualitySelect){
        // Prefer a provider that accepts a quality cap, otherwise say so plainly.
        const capable=orderedSources().find((s)=>s.qualitySelect);
        if(capable&&value!=='auto'){
          state.player.source=capable.id; state.player.autoIdx=0;
          renderSourceChips();
          toast(state.uiLang==='hi'?`${capable.name} पर स्विच किया (क्वालिटी सपोर्ट)`:`Switched to ${capable.name} for quality control`);
        }
      }
      state.player.autoIdx=0;
      loadStream(true);
      toast(value==='auto'
        ?(state.uiLang==='hi'?'क्वालिटी: ऑटो':'Quality: Auto')
        :(state.uiLang==='hi'?`क्वालिटी: ${value}p`:`Quality: ${value}p`));
    };
  }
  const speedSelect=$('#pcSpeed');
  speedSelect.value=String(state.player.speed||1);
  speedSelect.onchange=(event)=>{
    const speed=Number(event.target.value)||1;
    state.player.speed=speed;
    localStorage.setItem('sv-playback-speed',String(speed));
    // Native playback owns the media element, so speed applies instantly.
    if(state.player.nativeActive){
      const v=$('#playerVideo'); if(v)v.playbackRate=speed;
      toast((state.uiLang==='hi'?'स्पीड: ':'Speed: ')+speed+'\u00d7');
      return;
    }
    if(state.player.media==='anime'){
      postPlayerSpeed(speed);
    }else{
      const source=activeSource();
      if(state.player.source===AUTO_ID){
        state.player.autoIdx=0; renderSourceChips(); loadStream(true);
      }else if(speed!==1&&!(source&&source.remoteSpeed)){
        // APIPlayer documents parent → player setSpeed. Auto mode ranks it
        // first while a custom speed is selected.
        state.player.source=AUTO_ID; state.player.autoIdx=0;
        renderSourceChips(); loadStream(true);
      }else{
        postPlayerSpeed(speed); schedulePlaybackSpeed();
      }
    }
    toast(t('speedApplied',{speed}));
  };
  function updateVoiceBoostButton(){
    const button=$('#pcVoiceBoost');if(!button)return;
    button.classList.toggle('active',Boolean(state.player.audioBoost));
    button.setAttribute('aria-pressed',state.player.audioBoost?'true':'false');
    button.textContent=state.player.audioBoost?`${t('voiceBoost')} ✓`:t('voiceBoost');
  }
  $('#pcVoiceBoost').onclick=()=>{
    state.player.audioBoost=!state.player.audioBoost;
    localStorage.setItem('sv-player-voice-boost',state.player.audioBoost?'1':'0');
    updateVoiceBoostButton();
    if(state.player.active&&state.player.media!=='anime'){
      if(state.player.audioBoost&&activeSource().id!=='vidcore'){
        state.player.source='vidcore';renderSourceChips();loadStream(true);
      }else{
        const frame=$('#playerFrame');
        try{
          frame.contentWindow.postMessage({action:'volume',value:1},'*');
          frame.contentWindow.postMessage({action:'setAudioBoost',value:state.player.audioBoost},'*');
          frame.contentWindow.postMessage({type:'AUDIO_BOOST',enabled:state.player.audioBoost},'*');
        }catch(error){}
      }
    }
    toast(state.player.audioBoost?t('voiceBoostOn'):t('voiceBoostOff'));
  };

  $('#playerAudioBtn').onclick = (e) => {
    e.stopPropagation();
    renderPlayerLanguageOptions();
    $('#playerLanguagePop').classList.toggle('hidden');
  };
  $('#playerLanguageClose').onclick = () => $('#playerLanguagePop').classList.add('hidden');
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#playerLanguagePop') && !e.target.closest('#playerAudioBtn')) $('#playerLanguagePop').classList.add('hidden');
  });
  $('#pcReload').onclick = () => {
    loadStream(true);
    toast(t('reload'));
  };
  $('#playerFs').onclick=()=>{
    const el=document.querySelector('#playerModal .player');
    if (!el) return;
    if (!document.fullscreenElement) {
      const enter = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen;
      if (enter) enter.call(el);
    } else {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) exit.call(document);
    }
  };
  $('#pcPrev').onclick=()=>{
    const p=state.player;
    if(p.media==='anime'&&p.animeDirect){
      if(p.animeEpisode>1){p.animeEpisode--;renderAnimeEpisodeChips();loadAnimeStream(true);}
      return;
    }
    if(p.media!=='tv')return;
    if (p.episode>1){ p.episode--; renderEpisodeChips(); loadStream(); }
  };
  $('#pcNext').onclick=async()=>{
    const p=state.player;
    if(p.media==='anime'&&p.animeDirect){
      if(p.animeEpisode<Math.max(1,p.animeEpisodeCount)){
        p.animeEpisode++;renderAnimeEpisodeChips();loadAnimeStream(true);
        recordContinue({id:p.animeId,media_type:'anime',anime_source:p.animeSource,title:p.title,poster_path:p.backdrop||''},{animeSource:p.animeSource,episode:p.animeEpisode});
      }
      return;
    }
    if(p.media!=='tv')return;
    const idx=p.episodes.findIndex(e=>e.episode_number===p.episode);
    if (idx>=0 && idx<p.episodes.length-1) p.episode=p.episodes[idx+1].episode_number;
    else if (p.seasons.some(s=>s.season_number===p.season+1)) { p.season++; p.episode=1; renderSeasonSelect(); await loadPlayerEpisodes(); renderEpisodeChips(); }
    else return;
    loadStream();
    recordContinue({id:p.tmdbId,media_type:'tv',title:p.title,vote_average:0,release_date:''},{season:p.season,episode:p.episode});
  };
  $('#pcDownload').onclick = (e) => {
    // Build a small quality/download menu
    const existing = $('#dlMenu');
    if (existing) { existing.remove(); return; }
    const p = state.player;
    if (p.media === 'anime') {
      const href = (p.animeVideo && p.animeVideo.current && (p.animeVideo.current.external || p.animeVideo.current.url))
        || (p.animeVideo && p.animeVideo.official && p.animeVideo.official[0] && p.animeVideo.official[0].url);
      if (href) window.open(href, '_blank', 'noopener');
      else toast('No official link available yet');
      return;
    }
    const s = activeSource();
    const base = buildEmbedUrl(s);
    const menu = document.createElement('div');
    menu.id = 'dlMenu';
    menu.className = 'dl-menu';
    const opt = (label, sub, href) => `<a class="dl-opt" href="${esc(href)}" target="_blank" rel="noopener">
      <span class="dl-q">${esc(label)}</span>
      <span class="dl-sub">${esc(sub)}</span>
    </a>`;
    menu.innerHTML = `
      <div class="dl-head">
        <span>Open options</span>
        <button class="dl-x" aria-label="Close">×</button>
      </div>
      ${opt('Current source', 'Open the selected player in a new tab', base)}
      ${p.media==='tv' ? opt('TMDB page', 'Title information and official links', 'https://www.themoviedb.org/tv/' + p.tmdbId) : opt('TMDB page', 'Title information and official links', 'https://www.themoviedb.org/movie/' + p.tmdbId)}
      <div class="dl-note">StreamVerse does not host media files. Availability and quality are controlled by the selected provider.</div>
    `;
    document.body.appendChild(menu);
    const rect = e.currentTarget.getBoundingClientRect();
    menu.style.bottom = (window.innerHeight - rect.top + 8) + 'px';
    menu.style.left = Math.min(rect.left, window.innerWidth - 300) + 'px';
    menu.querySelector('.dl-x').onclick = () => menu.remove();
    setTimeout(() => {
      const closer = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', closer); } };
      setTimeout(() => document.addEventListener('click', closer), 50);
    }, 0);
  };
  $('#playerNextSrc').onclick = () => {
    // manually skip to next source
    const list = orderedSources();
    if (state.player.source === AUTO_ID) {
      state.player.autoIdx = (state.player.autoIdx + 1) % list.length;
      const token = ++state.player.loadToken;
      trySourceAtIndex(state.player.autoIdx, token);
    } else {
      // switch to next specific source
      const curIdx = list.findIndex((x) => x.id === state.player.source);
      const next = list[(curIdx + 1) % list.length];
      state.player.source = next.id;
      localStorage.setItem('sv-source', next.id);
      renderSourceChips();
      loadStream(true);
      toast(`${t('source')}: ${next.name}`);
    }
  };
  $('#playerPlaylistAdd').onclick = () => {
    const p = state.player;
    const isAnime=p.catalogueMedia==='anime';
    const id=isAnime?p.animeId:p.tmdbId;
    if(!id)return;
    openPlaylistModal({id,media:isAnime?'anime':p.media,animeSource:isAnime?p.animeSource:null,title:p.title,poster:p.backdrop||'',backdrop:p.backdrop||'',vote_average:0,release_date:''});
  };

  /* ================= LIVE TV ================= */
  function liveCategoryLabel(category) {
    if (state.uiLang !== 'hi') return category;
    return ({ All:'सभी', News:'समाचार', Entertainment:'मनोरंजन', Movies:'फ़िल्में', Sports:'खेल', Kids:'बच्चे', Music:'संगीत', Education:'शिक्षा', Spiritual:'आध्यात्मिक' })[category] || category;
  }

  function showLiveTV() {
    hideAllViews(); $('#liveView').classList.remove('hidden'); window.scrollTo({top:0}); closeMobileMenu();
    renderLiveChannels();
  }
  function renderLiveChannels(filter='All') {
    const chips = $('#liveChips');
    if (!chips.children.length) {
      const cats = ['All', ...Array.from(new Set(LIVE_CHANNELS.map(c=>c.cat)))];
      cats.forEach((cat) => {
        const b = document.createElement('button'); b.className='cat-chip'+(cat==='All'?' active':''); b.textContent=liveCategoryLabel(cat);
        b.onclick = () => { $$('#liveChips .cat-chip').forEach(x=>x.classList.remove('active')); b.classList.add('active'); renderLiveChannels(cat); };
        chips.appendChild(b);
      });
    }
    const grid = $('#liveGrid'); grid.innerHTML='';
    const list = filter==='All' ? LIVE_CHANNELS : LIVE_CHANNELS.filter(c=>c.cat===filter);
    list.forEach((ch) => {
      const card = document.createElement('div'); card.className='live-card';
      card.tabIndex=0;
      card.innerHTML = `
        <div class="lc-logo">${ch.logo}</div>
        <div class="lc-meta">
          <div class="lc-name">${esc(ch.name)}</div>
          <div class="lc-cat">${esc(liveCategoryLabel(ch.cat))} <span class="lc-live"><span class="live-dot sm"></span> ${state.uiLang==='hi'?'लाइव':'LIVE'}</span></div>
        </div>`;
      card.onclick = () => openLivePlayer(ch);
      card.onkeydown = (e) => { if(e.key==='Enter'||e.key===' '){e.preventDefault(); openLivePlayer(ch);} };
      grid.appendChild(card);
    });
  }

  let hlsLoaderPromise = null;
  function loadExternalScript(url) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url; script.async = true;
      if (/^https?:/i.test(url)) script.crossOrigin = 'anonymous';
      script.onload = resolve; script.onerror = () => { script.remove(); reject(new Error('script load failed')); };
      document.head.appendChild(script);
    });
  }
  async function ensureHls() {
    if (window.Hls) return window.Hls;
    if (!hlsLoaderPromise) {
      hlsLoaderPromise = (async () => {
        // Self-hosted first: no CDN dependency, works offline via the service
        // worker, and keeps the CSP tight. Remote copies stay as a safety net.
        const urls = [
          '/hls.min.js',
          'https://cdn.jsdelivr.net/npm/hls.js@1.5.18/dist/hls.min.js',
          'https://unpkg.com/hls.js@1.5.18/dist/hls.min.js',
        ];
        let lastError;
        for (const url of urls) {
          try { await loadExternalScript(url); if (window.Hls) return window.Hls; }
          catch (error) { lastError = error; }
        }
        throw lastError || new Error('HLS library unavailable');
      })().catch((error) => { hlsLoaderPromise = null; throw error; });
    }
    return hlsLoaderPromise;
  }

  async function openLivePlayer(channel) {
    $('#livePlayerModal').classList.remove('hidden');
    document.body.style.overflow='hidden';
    $('#liveTitle').innerHTML = `<span class="live-dot"></span> ${esc(channel.name)} <span style="opacity:.6;font-weight:500">— ${esc(channel.cat)}</span>`;
    const video = $('#liveVideo');
    const loading = $('#liveLoading'); loading.classList.remove('hidden');
    $('#liveMeta').textContent = t('connecting');
    destroyLive();
    state.live.currentChannel = channel;
    $('#liveVoiceVolume').value=String(state.live.boostLevel||1.3);
    setLiveAudioEnhancement(state.live.enhanced,true);
    const proxyUrl = '/api/hls?url=' + encodeURIComponent(channel.url);

    // Safari plays HLS natively; use the rewritten same-origin manifest so
    // HTTP channels and relative segments work on an HTTPS Render deployment.
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = proxyUrl;
      video.addEventListener('loadedmetadata', () => {
        if (state.live.currentChannel !== channel) return;
        loading.classList.add('hidden');
        $('#liveMeta').textContent = `${channel.name} · ${channel.cat}`;
        video.play().catch(()=>{});
      }, { once: true });
      video.addEventListener('error', () => {
        loading.classList.add('hidden'); $('#liveMeta').textContent = t('streamUnavailable');
      }, { once: true });
      return;
    }

    let HlsClass;
    try { HlsClass = await ensureHls(); }
    catch (e) {
      if (state.live.currentChannel !== channel) return;
      loading.classList.add('hidden'); $('#liveMeta').textContent = t('hlsUnsupported'); return;
    }
    if (state.live.currentChannel !== channel) return;
    if (!HlsClass || !HlsClass.isSupported()) {
      loading.classList.add('hidden'); $('#liveMeta').textContent = t('hlsUnsupported'); return;
    }

    const hls = new HlsClass({
      lowLatencyMode: false,
      backBufferLength: 15,
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      capLevelToPlayerSize: true,
      startLevel: -1,
      enableWorker: true,
      manifestLoadingTimeOut: 15000,
      fragLoadingTimeOut: 20000,
    });
    state.live.hls = hls;
    let mediaRecoveryTried = false;
    let networkRecoveryTried = false;
    hls.loadSource(proxyUrl);
    hls.attachMedia(video);
    hls.on(HlsClass.Events.MANIFEST_PARSED, () => {
      if (state.live.currentChannel !== channel) return;
      loading.classList.add('hidden');
      $('#liveMeta').textContent = `${channel.name} · ${channel.cat}`;
      populateQualityLevels(hls);
      video.play().catch(()=>{});
    });
    hls.on(HlsClass.Events.LEVEL_SWITCHED, () => populateQualityLevels(hls));
    hls.on(HlsClass.Events.ERROR, (event, data) => {
      if (!data || !data.fatal || state.live.currentChannel !== channel) return;
      if (data.type === HlsClass.ErrorTypes.NETWORK_ERROR && !networkRecoveryTried) {
        networkRecoveryTried = true;
        window.setTimeout(() => hls.startLoad(), 900);
        return;
      }
      if (data.type === HlsClass.ErrorTypes.MEDIA_ERROR && !mediaRecoveryTried) {
        mediaRecoveryTried = true;
        hls.recoverMediaError();
        return;
      }
      loading.classList.add('hidden');
      $('#liveMeta').textContent = t('streamUnavailable');
      try { hls.destroy(); } catch(e) {}
      if (state.live.hls === hls) state.live.hls = null;
    });
  }
  function populateQualityLevels(hls) {
    const select = $('#liveQuality');
    const levels = hls.levels || [];
    select.innerHTML = `<option value="-1">${state.uiLang==='hi'?'ऑटो':'Auto'}</option>` + levels.map((level, index) => {
      const resolution = level.height ? level.height + 'p' : `${Math.round(level.bitrate/1000)} kbps`;
      return `<option value="${index}">${resolution}</option>`;
    }).join('');
    select.value = hls.autoLevelEnabled ? '-1' : String(hls.currentLevel);
    select.onchange = () => { hls.currentLevel = parseInt(select.value,10); };
  }
  function destroyLive() {
    if (state.live.hls) { try { state.live.hls.destroy(); } catch(e){} state.live.hls = null; }
    state.live.currentChannel = null;
    const video = $('#liveVideo');
    if (video) { try { video.pause(); video.removeAttribute('src'); video.load(); } catch(e){} }
  }

  function setLiveAudioEnhancement(enabled,silent=false) {
    const live=state.live,video=$('#liveVideo');
    try{
      const AudioContextClass=window.AudioContext||window.webkitAudioContext;
      if(!AudioContextClass)throw new Error('Web Audio unavailable');
      if(!live.audioContext)live.audioContext=new AudioContextClass();
      if(!live.audioSource){
        live.audioSource=live.audioContext.createMediaElementSource(video);
        live.highpass=live.audioContext.createBiquadFilter(); live.highpass.type='highpass';
        live.lowShelf=live.audioContext.createBiquadFilter(); live.lowShelf.type='lowshelf';
        live.voiceEq=live.audioContext.createBiquadFilter(); live.voiceEq.type='peaking';
        live.compressor=live.audioContext.createDynamicsCompressor(); live.gain=live.audioContext.createGain();
        live.audioSource.connect(live.highpass).connect(live.lowShelf).connect(live.voiceEq).connect(live.compressor).connect(live.gain).connect(live.audioContext.destination);
      }
      live.enhanced=Boolean(enabled); localStorage.setItem('sv-live-enhance',live.enhanced?'1':'0');
      if(live.enhanced){
        live.highpass.frequency.value=82;
        live.lowShelf.frequency.value=180; live.lowShelf.gain.value=-2.2;
        live.voiceEq.frequency.value=2800; live.voiceEq.Q.value=.9; live.voiceEq.gain.value=4;
        live.compressor.threshold.value=-30; live.compressor.knee.value=20; live.compressor.ratio.value=4.5;
        live.compressor.attack.value=.006; live.compressor.release.value=.24;
      }else{
        live.highpass.frequency.value=20; live.lowShelf.gain.value=0; live.voiceEq.gain.value=0;
        live.compressor.threshold.value=0; live.compressor.knee.value=0; live.compressor.ratio.value=1;
      }
      live.gain.gain.value=Math.max(1,Math.min(1.5,Number(live.boostLevel)||1.3));
      live.audioContext.resume().catch(()=>{});
      const button=$('#liveAudioEnhance');
      button.classList.toggle('active',live.enhanced);button.setAttribute('aria-pressed',live.enhanced?'true':'false');
      button.textContent=live.enhanced?(state.uiLang==='hi'?'साफ़ व तेज़ आवाज़ ✓':'Clear voice ✓'):t('clearAudio');
      if(!silent)toast(live.enhanced?t('audioEnhanced'):t('audioNormal'));
    }catch(error){
      if(!silent)toast(state.uiLang==='hi'?'इस ब्राउज़र में ऑडियो सुधार उपलब्ध नहीं है।':'Audio enhancement is unavailable in this browser.');
    }
  }
  $('#liveVoiceVolume').onchange=(event)=>{
    state.live.boostLevel=Math.max(1,Math.min(1.5,Number(event.target.value)||1));
    localStorage.setItem('sv-live-voice-volume',String(state.live.boostLevel));
    if(state.live.gain)state.live.gain.gain.value=state.live.boostLevel;
    toast(`${t('voiceVolume')}: ${Math.round(state.live.boostLevel*100)}%`);
  };

  $('#liveClose').onclick = () => {
    destroyLive(); $('#livePlayerModal').classList.add('hidden');
    if ($('#detailModal').classList.contains('hidden')&&$('#playerModal').classList.contains('hidden')) document.body.style.overflow='';
  };
  $('#liveFs').onclick = () => {
    const video = $('#liveVideo');
    if (!document.fullscreenElement) { const request=video.requestFullscreen||video.webkitRequestFullscreen||video.mozRequestFullScreen; if(request) request.call(video); }
    else { const exit=document.exitFullscreen||document.webkitExitFullscreen; if(exit) exit.call(document); }
  };
  $('#liveSpeed').onchange = (e) => { $('#liveVideo').playbackRate = parseFloat(e.target.value); toast(`${t('speed')} ${e.target.value}×`); };
  $('#liveMute').onclick = () => {
    const video=$('#liveVideo'); video.muted = !video.muted;
    $('#liveMuteText').textContent = video.muted ? t('unmute') : t('mute');
    toast(video.muted ? t('mute') : t('unmute'));
  };
  $('#liveAudioEnhance').onclick = () => setLiveAudioEnhancement(!state.live.enhanced);
  $('#livePip').onclick = async () => {
    const video=$('#liveVideo');
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (document.pictureInPictureEnabled && video.requestPictureInPicture) await video.requestPictureInPicture();
    } catch(e) { toast('PiP unavailable'); }
  };

  /* ================= MODAL PLUMBING ================= */
  function showModal() { closePlayer(); $('#detailModal').classList.remove('hidden'); $('#modalBody').innerHTML=''; $('#modalBackdrop').style.backgroundImage='none'; document.body.style.overflow='hidden'; }
  $('#modalClose').onclick=closeModal;
  $('#detailModal').addEventListener('click',(e)=>{ if(e.target===$('#detailModal')) closeModal(); });
  function closeModal() { $('#detailModal').classList.add('hidden'); if ($('#playerModal').classList.contains('hidden')&&$('#livePlayerModal').classList.contains('hidden')) document.body.style.overflow=''; }
  document.addEventListener('keydown',(e)=>{ if(e.key==='Escape'){ closePlayer(); destroyLive(); $('#livePlayerModal').classList.add('hidden'); closeModal(); closeSettings(); $('#playlistModal').classList.add('hidden'); closeBravePromo(false); } });

  function trapFocus(container) {
    const focusables = container.querySelectorAll('button,[href],input,select,[tabindex]:not([tabindex="-1"])');
    if (!focusables.length) return;
    const first=focusables[0], last=focusables[focusables.length-1];
    if (container._trap) container.removeEventListener('keydown', container._trap);
    container._trap=(e)=>{
      if (e.key!=='Tab') return;
      if (e.shiftKey && document.activeElement===first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement===last) { e.preventDefault(); first.focus(); }
    };
    container.addEventListener('keydown', container._trap);
    setTimeout(()=>first.focus(),80);
  }
  new MutationObserver(()=>{
    if (!$('#detailModal').classList.contains('hidden')) trapFocus($('#detailModal'));
    if (!$('#playerModal').classList.contains('hidden')) trapFocus($('#playerModal'));
    if (!$('#settingsModal').classList.contains('hidden')) trapFocus($('#settingsModal'));
    if (!$('#livePlayerModal').classList.contains('hidden')) trapFocus($('#livePlayerModal'));
    if (!$('#playlistModal').classList.contains('hidden')) trapFocus($('#playlistModal'));
    if (!$('#bravePromo').classList.contains('hidden')) trapFocus($('#bravePromo'));
  }).observe(document.body,{attributes:true,subtree:true,attributeFilter:['class']});

  /* ================= SETTINGS ================= */
  function closeSettings() {
    $('#settingsModal').classList.add('hidden');
    if ($('#playerModal').classList.contains('hidden') && $('#detailModal').classList.contains('hidden') && $('#livePlayerModal').classList.contains('hidden')) {
      document.body.style.overflow='';
    }
  }
  function refreshLocalizedContent() {
    applyUiLanguage();
    // Re-render whichever view is on screen. Previously the results/browse
    // views were skipped, so switching language left them in the old language.
    if (!$('#content').classList.contains('hidden')) loadHome();
    else if (!$('#mylistView').classList.contains('hidden')) renderMyList();
    else if (!$('#playlistsView').classList.contains('hidden')) renderPlaylists();
    else if (!$('#liveView').classList.contains('hidden')) { $('#liveChips').innerHTML=''; renderLiveChannels(); }
    else if ($('#resultsView') && !$('#resultsView').classList.contains('hidden')) {
      const route=(location.hash.replace('#','')||'').toLowerCase();
      if(state.search.query) { doSearch(state.search.query); }
      else if(['movies','tv','anime'].includes(route)) showResultsForNav(route);
      else if(route==='drama') showDrama();
    }
    // Re-render any open modal so its labels follow the new language too.
    if ($('#detailModal') && !$('#detailModal').classList.contains('hidden') && state.detail) {
      const d=state.detail;
      if(d.media==='anime') openAnimeDetail(d.id,null,d.title,d.animeSource||'mal');
      else if(d.id) openDetail(d.media,d.id,d.title);
    }
    if (state.player.active) {
      if (state.player.media === 'anime' && state.player.animeDirect) {
        renderAnimeSourceChips(); renderAnimeEpisodeChips();
        syncAnimeAudioControl();
      } else {
        renderSourceChips();
        if (state.player.details) populateAudioLanguages(state.player.details);
      }
      updateQualityControlState();
    }
    const recShow=$('#pcRecShow');
    if(recShow)recShow.textContent=t('showRecommendations');
    const recCollapse=$('#pcRecCollapse');
    if(recCollapse)recCollapse.textContent=$('#pcRecRow').classList.contains('collapsed')?t('expand'):t('collapse');
  }
  function refreshContentLocale() {
    if (!$('#content').classList.contains('hidden')) return;
    const route = (location.hash.replace('#','') || '').toLowerCase();
    if (['movies','tv','anime'].includes(route)) showResultsForNav(route);
    else if (route === 'drama') showDrama();
  }

  $('#settingsBtn').onclick=openSettings;
  $('#settingsClose').onclick=closeSettings;
  $('#settingsModal').addEventListener('click',(e)=>{ if(e.target===$('#settingsModal')) closeSettings(); });
  async function openSettings() {
    const modal=$('#settingsModal'); modal.classList.remove('hidden');
    document.body.style.overflow='hidden';
    applyUiLanguage();

    const uiSelect=$('#setUiLang');
    uiSelect.innerHTML=UI_LANGS.map(([code,label])=>`<option value="${code}" ${code===state.uiLang?'selected':''}>${esc(label)}</option>`).join('');
    uiSelect.onchange=()=>{
      state.uiLang=uiSelect.value === 'hi' ? 'hi' : 'en';
      localStorage.setItem('sv-ui-lang',state.uiLang);
      if(state.uiLang==='hi'&&!state.player.audioLang){state.player.audioLang='hi';localStorage.setItem('sv-audio-lang','hi');}
      refreshLocalizedContent();
      toast(state.uiLang === 'hi' ? t('interfaceUpdated') : 'Interface changed to English');
      openSettings();
    };

    const languageSelect=$('#setLang');
    languageSelect.innerHTML=LANGS.map(([code,label])=>`<option value="${code}" ${code===state.lang?'selected':''}>${esc(label)}</option>`).join('');
    languageSelect.onchange=()=>{
      state.lang=languageSelect.value;
      localStorage.setItem('sv-lang',state.lang);
      const preferred = String(state.lang).slice(0,2).toLowerCase();
      if (AUDIO_NAMES[preferred]) {
        state.player.audioLang=preferred;
        localStorage.setItem('sv-audio-lang',preferred);
      }
      // Selecting Hindi content also enables the Hindi interface. Users can
      // still change the interface independently with the control above.
      if (state.lang.startsWith('hi')) {
        state.uiLang='hi'; localStorage.setItem('sv-ui-lang','hi');
      }
      apiCache.clear();
      refreshLocalizedContent();
      refreshContentLocale();
      toast(t('languageUpdated'));
      openSettings();
    };

    const audioSelect=$('#setAudioLang');
    const audioChoices=[['',t('preferredAudioAuto')],['hi','Hindi'],['en','English'],['ta','Tamil'],['te','Telugu'],['ml','Malayalam'],['bn','Bengali']];
    audioSelect.innerHTML=audioChoices.map(([code,label])=>`<option value="${code}" ${code===state.player.audioLang?'selected':''}>${esc(label)}</option>`).join('');
    audioSelect.onchange=()=>{
      state.player.audioLang=audioSelect.value; localStorage.setItem('sv-audio-lang',audioSelect.value);
      toast(audioSelect.value?t('audioPreference',{language:audioSelect.options[audioSelect.selectedIndex].textContent}):t('audioDefault'));
      if(state.player.active){populateAudioLanguages(state.player.details||{});renderSourceChips();loadStream(true);}
    };

    // Default stream quality cap (mirrors the in-player selector).
    const qualitySetting=$('#setQuality');
    if(qualitySetting){
      qualitySetting.value=state.player.quality||'auto';
      qualitySetting.onchange=()=>{
        const value=QUALITY_VALUES.includes(qualitySetting.value)?qualitySetting.value:'auto';
        state.player.quality=value; localStorage.setItem('sv-quality',value);
        const inPlayer=$('#pcQuality'); if(inPlayer)inPlayer.value=value;
        toast(value==='auto'?t('quality')+': Auto':t('quality')+': '+value+'p');
        if(state.player.active&&state.player.media!=='anime'){state.player.autoIdx=0;loadStream(true);}
      };
    }

    // Anime sub/dub preference.
    const animeAudioSetting=$('#setAnimeAudio');
    if(animeAudioSetting){
      animeAudioSetting.value=state.player.animeDub?'dub':'sub';
      animeAudioSetting.onchange=()=>{
        const wantDub=animeAudioSetting.value==='dub';
        state.player.animeDub=wantDub; localStorage.setItem('sv-anime-dub',wantDub?'1':'0');
        toast(wantDub?t('dubAudio'):t('subAudio'));
        if(state.player.active&&state.player.media==='anime'&&state.player.animeDirect){
          setupAnimePlayerChrome(); renderAnimeSourceChips(); state.player.animeAutoIdx=0; loadAnimeStream(true);
        }
      };
    }

    // Recommendations-while-watching preference.
    const recsSetting=$('#setShowRecs');
    if(recsSetting){
      recsSetting.value=recsHidden()?'0':'1';
      recsSetting.onchange=()=>{
        const hide=recsSetting.value==='0';
        setRecsHidden(hide);
        toast(hide?t('recsHidden'):t('recsShown'));
      };
    }

    await ensureCountries();
    const countrySelect=$('#setCountry');
    countrySelect.innerHTML=`<option value="">${esc(t('autoDetect'))}</option>`+state.countries.map(c=>`<option value="${c.code}" ${c.code===state.country?'selected':''}>${esc(c.name)}</option>`).join('');
    countrySelect.onchange=()=>{
      state.country=countrySelect.value; localStorage.setItem('sv-country',state.country); toast(t('regionUpdated'));
    };
    $('#setGeoBtn').onclick = async () => {
      try {
        const geo = await api('/geo', { noCache: true });
        state.country = geo.country_code || 'IN';
        localStorage.setItem('sv-country', state.country);
        toast(t('regionDetected',{ region:geo.country || state.country }));
        openSettings();
      } catch (e) { toast(t('regionFailed')); }
    };

    const sourceSelect = $('#setSource');
    sourceSelect.innerHTML = `<option value="${AUTO_ID}" ${state.player.source===AUTO_ID?'selected':''}>⚡ ${esc(t('autoBest'))}</option>` +
      orderedSources(true).map(source=>`<option value="${source.id}" ${source.id===state.player.source?'selected':''}>${esc(source.name)}</option>`).join('');
    sourceSelect.onchange = () => {
      state.player.source = sourceSelect.value;
      localStorage.setItem('sv-source',sourceSelect.value);
      toast(sourceSelect.value===AUTO_ID ? t('autoBest') : `${t('source')}: ${getSource(sourceSelect.value).name}`);
    };

    $('#setThemeBtn').textContent=document.body.classList.contains('light')?t('lightToDark'):t('darkToLight');
    $('#setThemeBtn').onclick=()=>{ toggleTheme(); openSettings(); };

    detectBrave().then((brave) => {
      const status = $('#setBraveStatus');
      const button = $('#setBraveBtn');
      if (brave) {
        status.textContent = state.uiLang === 'hi' ? 'Brave की विज्ञापन और ट्रैकर सुरक्षा चालू है।' : 'You are using Brave — built-in ad and tracker blocking is active.';
        button.textContent = state.uiLang === 'hi' ? 'Brave चालू है' : 'Brave is active';
        button.classList.remove('btn-play'); button.classList.add('btn-ghost');
        button.onclick = () => toast(status.textContent);
      } else {
        status.textContent = state.uiLang === 'hi' ? 'बेहतर प्लेबैक के लिए Brave या भरोसेमंद ऐड-ब्लॉकर उपयोग करें।' : 'Use Brave or a trusted ad blocker for faster, cleaner playback.';
        button.textContent = devicePlatform() === 'android' ? 'Get Brave on Play Store' : devicePlatform() === 'ios' ? 'Get Brave on App Store' : 'Download Brave';
        button.classList.remove('btn-ghost'); button.classList.add('btn-play');
        button.onclick = openBraveDownload;
      }
      $('#setBravePromoBtn').onclick = () => openBravePromo({ force: true });
    }).catch(() => {});

    const sandboxButton = $('#setSandboxBtn');
    sandboxButton.textContent = state.sandbox
      ? (state.uiLang==='hi'?'चालू (पॉपअप ब्लॉक)':'On (blocks popups)')
      : (state.uiLang==='hi'?'बंद (बेहतर प्लेबैक)':'Off (best playback)');
    sandboxButton.onclick = () => {
      state.sandbox = !state.sandbox;
      localStorage.setItem('sv-sandbox', state.sandbox ? '1' : '0');
      toast(state.sandbox
        ? (state.uiLang==='hi'?'पॉपअप सुरक्षा चालू — कुछ सर्वर लोड नहीं हो सकते।':'Popup protection on — a few sources may refuse to load.')
        : (state.uiLang==='hi'?'पॉपअप सुरक्षा बंद — बेहतर प्लेबैक।':'Popup protection off — best playback.'));
      openSettings();
    };

    const dateLocale = state.uiLang === 'hi' ? 'hi-IN' : undefined;
    $('#usageBox').innerHTML=`<div class="stat-grid">
      <div class="stat"><b>${fmtMB(usage.bytes)}</b><span>${esc(t('dataUsed'))}</span></div>
      <div class="stat"><b>${usage.reqs}</b><span>${esc(t('requests'))}</span></div>
      <div class="stat"><b>${new Date(usage.since).toLocaleDateString(dateLocale)}</b><span>${esc(t('since'))}</span></div>
      <div class="stat"><b>${state.watchlist.length}</b><span>${esc(t('savedTitles'))}</span></div>
    </div>`;
    $('#usageReset').onclick=()=>{
      usage={bytes:0,reqs:0,since:Date.now()}; saveUsage(); toast(t('resetStats')); openSettings();
    };
    $('#cacheClear').onclick=()=>{
      apiCache.clear();
      if ('caches' in window) caches.keys().then((keys)=>Promise.all(keys.map((key)=>caches.delete(key)))).catch(()=>{});
      toast(t('browserCacheCleared'));
      openSettings();
    };

    $('#backupInfo').innerHTML=`<div class="section-label">${esc(t('serverStatus'))}</div>`;
    api('/stats',{noCache:true}).then((serverStats)=>{
      const statusText=(value)=>value==='ok'?t('online'):value==='error'||value==='bad-key'?t('offline'):t('idle');
      $('#backupInfo').innerHTML=`<div class="api-chips">
        <span class="chip">TMDB: ${esc(serverStats.tmdb_configured ? statusText(serverStats.api_health.tmdb) : t('unavailable'))}</span>
        <span class="chip">Jikan: ${esc(statusText(serverStats.api_health.jikan))}</span>
        <span class="chip">Cinemeta: ${esc(statusText(serverStats.api_health.cinemeta))}</span>
        <span class="chip">AniList: ${esc(statusText(serverStats.api_health.anilist))}</span>
      </div>
      <div class="tiny-note">v${esc(serverStats.version||'?')} · ${Math.floor((serverStats.uptime_s||0)/60)} min · ${serverStats.cache_items||0} cached</div>`;
    }).catch(()=>{ $('#backupInfo').innerHTML=`<div class="tiny-note">${esc(t('unavailable'))}</div>`; });
  }
  async function ensureCountries() {
    if (state.countries.length) return;
    try { const d=await api('/countries'); state.countries=d.countries||[]; }
    catch(e) { state.countries=[{code:'IN',name:'India'},{code:'US',name:'United States'}]; }
  }

  /* ================= THEME ================= */
  function toggleTheme() {
    document.body.classList.toggle('light');
    const light=document.body.classList.contains('light');
    localStorage.setItem('sv-theme',light?'light':'dark');
    const moon=$('#themeBtn .ic-moon'), sun=$('#themeBtn .ic-sun');
    if(moon) moon.style.display=light?'none':'';
    if(sun) sun.style.display=light?'':'none';
  }
  (function initTheme(){
    const saved=localStorage.getItem('sv-theme');
    const light=saved==='light'||(!saved&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches);
    if(light){ document.body.classList.add('light'); const moon=$('#themeBtn .ic-moon'),sun=$('#themeBtn .ic-sun'); if(moon)moon.style.display='none'; if(sun)sun.style.display=''; }
  })();
  $('#themeBtn').onclick=toggleTheme;

  function enhanceHorizontalRows() {
    $$('.row-section').forEach((section) => {
      const head = section.querySelector('.row-head');
      const row = section.querySelector('.card-row');
      if (!head || !row || head.querySelector('.row-scroll-controls')) return;
      const controls = document.createElement('div');
      controls.className = 'row-scroll-controls';
      const previous = document.createElement('button');
      const next = document.createElement('button');
      previous.type = next.type = 'button';
      previous.innerHTML = '‹'; next.innerHTML = '›';
      previous.setAttribute('aria-label', t('prev')); next.setAttribute('aria-label', t('next'));
      previous.onclick = () => row.scrollBy({ left: -Math.max(280, row.clientWidth * .82), behavior: 'smooth' });
      next.onclick = () => row.scrollBy({ left: Math.max(280, row.clientWidth * .82), behavior: 'smooth' });
      controls.append(previous, next); head.appendChild(controls);
      const update = () => {
        previous.disabled = row.scrollLeft < 8;
        next.disabled = row.scrollLeft + row.clientWidth >= row.scrollWidth - 8;
      };
      row.addEventListener('scroll', update, { passive: true });
      if ('ResizeObserver' in window) new ResizeObserver(update).observe(row);
      update();
    });
  }

  /* ================= SCROLL / TOP ================= */
  window.addEventListener('scroll',()=>{
    $('#navbar').classList.toggle('scrolled', window.scrollY>30);
    $('#toTop').classList.toggle('show', window.scrollY>600);
  },{passive:true});
  $('#toTop').onclick=()=>window.scrollTo({top:0,behavior:'smooth'});
  const playerFeed = $('#playerFeed');
  if (playerFeed) {
    playerFeed.addEventListener('scroll', () => {
      if (playerFeed.scrollTop > 36) {
        playerFeed.classList.add('has-scrolled');
        $('#feedSwipeHint')?.classList.add('dismissed');
      } else {
        playerFeed.classList.remove('has-scrolled');
      }
    }, { passive: true });
  }
  const scrollToRecommendations = () => {
    const target = $('#playerControls');
    if (playerFeed && target) playerFeed.scrollTo({ top: target.offsetTop, behavior: 'smooth' });
  };
  $('#feedSwipeHint').onclick = scrollToRecommendations;
  $('#feedSwipeHint').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); scrollToRecommendations(); } };
  $('#inlineRecOpen').onclick = scrollToRecommendations;
  // Hide / collapse recommendations while a video is playing
  $('#inlineRecClose').onclick = () => {
    setRecsHidden(true);
    toast(state.uiLang === 'hi' ? 'सुझाव छिपा दिए गए (सेटिंग्स में वापस चालू करें)' : 'Recommendations hidden — re-enable in Settings');
  };
  $('#pcRecHide').onclick = () => {
    setRecsHidden(true);
    toast(state.uiLang === 'hi' ? 'सुझाव छिपा दिए गए' : 'Recommendations hidden');
  };
  $('#pcRecCollapse').onclick = () => {
    const row = $('#pcRecRow');
    const collapsed = row.classList.toggle('collapsed');
    $('#pcRecCollapse').textContent = collapsed ? t('expand') : t('collapse');
  };

  /* keyboard shortcuts */
  document.addEventListener('keydown',(e)=>{
    if(e.target.tagName==='INPUT'||e.target.tagName==='SELECT'||e.target.tagName==='TEXTAREA') return;
    if(state.player.active||!$('#livePlayerModal').classList.contains('hidden')) return;
    if(e.key==='/'){ e.preventDefault(); searchWrap.classList.add('open'); setTimeout(()=>searchInput.focus(),100); }
    if(e.key==='Home'){ e.preventDefault(); navigate('home'); }
  });
  const css=document.createElement('style'); css.textContent='@keyframes spin{to{transform:rotate(360deg)}}'; document.head.appendChild(css);

  /* ================= Online-users presence =================
     Lightweight heartbeat every 30s; no fake audience is shown offline. */
  let presenceToken = sessionStorage.getItem('sv-ptoken') || '';
  async function pingPresence() {
    try {
      const r = await fetch('/api/ping?t=' + encodeURIComponent(presenceToken), { cache: 'no-store' });
      if (!r.ok) throw new Error('ping');
      const d = await r.json();
      if (d.token) { presenceToken = d.token; sessionStorage.setItem('sv-ptoken', d.token); }
      setOnlineCount(d.online);
    } catch (e) {
      setOnlineCount(null);
    }
  }
  function setOnlineCount(n) {
    const el = $('#onlineCount'); if (!el) return;
    if (!Number.isFinite(Number(n))) { el.textContent = '—'; return; }
    const cur = parseInt(el.textContent || '0', 10) || 0;
    if (cur === Number(n)) return;
    el.textContent = Number(n).toLocaleString();
    // Web Animations is cosmetic here and missing in some embedded webviews.
    if (typeof el.animate !== 'function') return;
    try {
      el.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }],
        { duration: 350, easing: 'ease-out' });
    } catch (e) { /* animation is optional */ }
  }
  pingPresence();
  setInterval(() => { if (!document.hidden) pingPresence(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pingPresence(); });

  /* ================= Back / home navigation =================
     - Brand/logo always goes home (works in every browser)
     - Back button closes any open modal/player before going back
     - Esc also closes player/modal (already handled elsewhere) */
  function goHome() {
    // close any open overlays first
    closePlayer();
    try { destroyLive(); $('#livePlayerModal').classList.add('hidden'); } catch(e){}
    closeModal();
    $('#settingsModal').classList.add('hidden');
    $('#playlistModal').classList.add('hidden');
    if (document.body.style.overflow) document.body.style.overflow = '';
    navigate('home');
  }
  document.addEventListener('click', (e) => {
    const brand = e.target.closest('.brand, .footer-brand');
    if (brand) { e.preventDefault(); goHome(); }
  });
  // If browser navigation happens while an overlay is open, clean up media
  // without inserting duplicate history entries.
  window.addEventListener('popstate', () => {
    const anyOpen = !$('#playerModal').classList.contains('hidden')
      || !$('#livePlayerModal').classList.contains('hidden')
      || !$('#detailModal').classList.contains('hidden')
      || !$('#settingsModal').classList.contains('hidden')
      || !$('#playlistModal').classList.contains('hidden')
      || !$('#bravePromo').classList.contains('hidden');
    if (!anyOpen) return;
    closePlayer();
    try { destroyLive(); $('#livePlayerModal').classList.add('hidden'); } catch(e){}
    closeModal(); closeSettings();
    $('#playlistModal').classList.add('hidden');
    closeBravePromo(false);
  });

  /* ================= Brave / ad-block recommendation ========== */
  const BRAVE_LINKS = {
    desktop: 'https://brave.com/download/',
    android: 'https://play.google.com/store/apps/details?id=com.brave.browser',
    ios: 'https://apps.apple.com/us/app/brave-browser-search-engine/id1052879175',
  };
  let braveDetection = null;
  let bravePreviousOverflow = '';

  function devicePlatform() {
    const ua = navigator.userAgent || '';
    if (/android/i.test(ua)) return 'android';
    if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
    return 'desktop';
  }

  async function detectBrave() {
    if (braveDetection !== null) return braveDetection;
    try {
      const api = navigator.brave && typeof navigator.brave.isBrave === 'function';
      braveDetection = Boolean(api && await navigator.brave.isBrave());
    } catch (e) {
      braveDetection = /Brave/i.test(navigator.userAgent || '');
    }
    return braveDetection;
  }

  function braveDownloadUrl() {
    const platform = devicePlatform();
    return platform === 'android' ? BRAVE_LINKS.android : platform === 'ios' ? BRAVE_LINKS.ios : BRAVE_LINKS.desktop;
  }

  function openBraveDownload() {
    const url = braveDownloadUrl();
    const tab = window.open(url, '_blank', 'noopener,noreferrer');
    // If a browser blocks a new tab, the same user click still navigates safely.
    if (!tab) window.location.href = url;
  }

  function closeBravePromo(saveChoice = false) {
    const modal = $('#bravePromo');
    if (!modal || modal.classList.contains('hidden')) return;
    if (saveChoice || $('#braveDontShow').checked) localStorage.setItem('sv-brave-promo-dismissed', '1');
    modal.classList.add('hidden');
    if ($('#settingsModal').classList.contains('hidden') && $('#playerModal').classList.contains('hidden') && $('#detailModal').classList.contains('hidden')) {
      document.body.style.overflow = bravePreviousOverflow || '';
    } else {
      document.body.style.overflow = 'hidden';
    }
  }

  async function openBravePromo({ force = false } = {}) {
    if (!force && (localStorage.getItem('sv-brave-promo-dismissed') === '1' || localStorage.getItem('sv-brave-hint') === '1')) return;
    const modal = $('#bravePromo');
    if (!modal) return;
    const brave = await detectBrave();
    const platform = devicePlatform();
    const title = $('#bravePromoTitle');
    const text = $('#bravePromoText');
    const detected = $('#braveDetected');
    const primary = $('#bravePrimaryBtn');
    const stores = $('#braveStores');
    if (brave) {
      title.textContent = 'You are using Brave';
      text.textContent = 'Great — Brave protection is already active. Ads and trackers are blocked before they slow down your watch experience.';
      detected.classList.remove('hidden');
      primary.textContent = 'Continue watching';
      primary.onclick = () => closeBravePromo(false);
      stores.classList.add('hidden');
    } else {
      title.textContent = 'Use Brave for the best experience';
      text.textContent = 'Brave has built-in ad and tracker blocking. If you prefer your current browser, a trusted ad blocker such as uBlock Origin also works.';
      detected.classList.add('hidden');
      primary.textContent = platform === 'android' ? 'Get Brave on Google Play' : platform === 'ios' ? 'Get Brave on the App Store' : 'Download Brave';
      primary.onclick = () => { openBraveDownload(); closeBravePromo(false); };
      stores.classList.remove('hidden');
    }
    $('#braveDontShow').checked = false;
    bravePreviousOverflow = document.body.style.overflow;
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  $('#bravePromoClose').onclick = () => closeBravePromo(false);
  $('#braveConfirmBtn').onclick = () => closeBravePromo(false);
  $('#bravePromo').addEventListener('click', (e) => { if (e.target === $('#bravePromo')) closeBravePromo(false); });

  // The recommendation stays available in Settings; do not interrupt a new
  // visitor with a full-screen promo while the catalogue is loading.

  /* ================= Environment check =================
     Embedded preview/file mode cannot reliably run cross-origin players.
     Render/Node HTTP mode is the supported deployment path. */
  (function envCheck() {
    const isFile = location.protocol === 'file:';
    const isSandboxed = (() => {
      try { return window.self !== window.top || !window.top; } catch(e) { return true; }
    })();
    if (!isFile && (!isSandboxed || state.useServer)) return;
    document.addEventListener('DOMContentLoaded', () => {
      const bar = document.createElement('div');
      bar.className = 'env-banner';
      bar.innerHTML = `
        <div class="env-banner-in">
          <div>
            <b>🎬 Open the Render deployment (or run node server.js) for video playback.</b>
            <small style="opacity:.78">The downloaded/file preview can show the catalogue, but browsers block embedded players there.</small>
          </div>
          <div class="env-btns">
            <button class="env-close" id="envClose" aria-label="Dismiss">×</button>
          </div>
        </div>`;
      document.body.appendChild(bar);
      document.getElementById('envClose').onclick = () => bar.remove();
    });
  })();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      // The query string MUST track APP_VERSION. A stale value here meant the
      // browser kept an old worker alive, which kept serving a cache-first
      // app.js from a previous release -- the classic "my fixes didn't apply"
      // bug. Reload once when a new worker takes control so the user always
      // lands on current code without a manual hard-refresh.
      navigator.serviceWorker.register('/sw.js?v=' + APP_VERSION).then((reg) => {
        reg.update?.();
        reg.addEventListener?.('updatefound', () => {
          const sw = reg.installing;
          sw?.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) sw.postMessage({ type: 'SKIP_WAITING' });
          });
        });
      }).catch(() => {});
      let reloadedForSw = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloadedForSw) return;
        reloadedForSw = true;
        location.reload();
      });
    }, { once: true });
  }

  /* ================= Init ================= */
  (async function init(){
    applyUiLanguage(); enhanceHorizontalRows();
    renderRoute(location.hash.replace('#','') || 'home');
    ensureCountries();
    if (!state.country) {
      try { const g=await api('/geo',{noCache:true}); state.country=g.country_code||'IN'; localStorage.setItem('sv-country',state.country); }
      catch(e) { state.country='IN'; }
    }
    window.addEventListener('hashchange',()=>{
      renderRoute(location.hash.replace('#','')||'home');
    });
  })();
})();
