/** Small, reviewed fallback catalog. No audio is bundled or fetched on import.
 * Evidence: Commons imageinfo + the composer's instruments/feel in
 * https://incompetech.com/music/royalty-free/pieces.json (2026-10-19).
 * The exact recording is pinned so later uploads cannot inherit this review.
 * Mood is editorial metadata, not a claim of listening/quality acceptance.
 */
export const MUSIC_CATALOG_VERSION = 'commons-instrumentals-20261019-v1';
export const DOCUMENTARY_MUSIC_CATALOG = [
  {
    name: 'The Complex', title: 'File:The Complex (ISRC USUAN1300025).mp3',
    url: 'https://upload.wikimedia.org/wikipedia/commons/c/c8/The_Complex_%28ISRC_USUAN1300025%29.mp3',
    sha1: 'a6cad7f2c0715e424306398c217f931b3f4ea7b0', durationSeconds: 267.7551,
    moods: ['energetic'], description: 'Instrumental electronic soundtrack. Synths, percussion. Driving, action, epic, intense.',
    authorPage: 'https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1300025',
  },
  {
    name: 'Dark Times', title: 'File:Dark Times (ISRC USUAN1100747).mp3',
    url: 'https://upload.wikimedia.org/wikipedia/commons/9/93/Dark_Times_%28ISRC_USUAN1100747%29.mp3',
    sha1: 'ed70e867136ee9ff3006ccf032ae8fdd43b1fcd2', durationSeconds: 183.696,
    moods: ['tension'], description: 'Instrumental strings soundtrack. Dark, somber, troubling, suspense.',
    authorPage: 'https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100747',
  },
  {
    name: 'Clean Soul', title: 'File:Clean Soul (ISRC USUAN1300033).mp3',
    url: 'https://upload.wikimedia.org/wikipedia/commons/f/f7/Clean_Soul_%28ISRC_USUAN1300033%29.mp3',
    sha1: 'b9bbe610c24f91a63246e4030a0f88b6fdba64d5', durationSeconds: 306.7298,
    moods: ['calm', 'reflective'], description: 'Instrumental electric piano and bass. Soft, spacious, calming, relaxed, reflective.',
    authorPage: 'https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1300033',
  },
  {
    name: 'Floating Cities', title: 'File:Floating Cities (ISRC USUAN1600018).mp3',
    url: 'https://upload.wikimedia.org/wikipedia/commons/3/3f/Floating_Cities_%28ISRC_USUAN1600018%29.mp3',
    sha1: 'fe61c7d5004508eaacbdc6470b1dd35c582ccccb', durationSeconds: 184.05878125,
    moods: ['discovery'], description: 'Instrumental electronic soundtrack. Synths, percussion. Futuristic, mystical, somber, relaxed, ambient.',
    authorPage: 'https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1600018',
  },
] as const;

export function catalogMusicForMood(mood: string) {
  return DOCUMENTARY_MUSIC_CATALOG.find(track => (track.moods as readonly string[]).includes(mood));
}
