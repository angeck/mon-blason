// mypocketclub · réglages généraux de l'application.
// N° 97 : nom « mypocketclub », un seul mot, toujours en minuscules (même en début de phrase) ; lecteurs d'écran : « my pocket club ».
// Le nom n'est écrit qu'ici (et dans manifest.webmanifest et index.html, lus par les téléphones à l'installation).
export const BRAND = { name: 'mypocketclub', title: 'mypocketclub', aria: 'my pocket club', slogan: '', contact: 'contact@mypocketclub.fr', editor: 'Gaël Raveneau (particulier)',
  // Site de mypocketclub (affiché même tant que le domaine n'est pas branché sur l'application) et expéditeur des e-mails automatiques (n° 107)
  site: 'mypocketclub.fr', siteUrl: 'https://mypocketclub.fr', mailFrom: 'notifications@mypocketclub.fr' };
// Adresse et clé publique du projet Supabase. La clé « publishable » est faite pour être visible :
// les données sont protégées par les règles d'accès (RLS) de la base.
export const SUPABASE_URL = 'https://rmdszovbpmagtvugfrpr.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_KsSQGA_bD3QSpX1vjnYjUw_eYBXXJ2u';
export const VERSION = 'alpha 4.6.0';
// Alpha 3.2.5 · profils de test : liste déroulante « Profil de test » visible seulement quand on est connecté avec un des comptes de la liste.
// 4.3.0 · n° 126 (audit du 5 novembre 2026) : la liste n'est plus écrite ici (ce fichier est public) ; elle est rangée dans la base
// (table test_profiles, remplie par le script privé du projet) et lue après la connexion par js/v43.js, qui remplit ce tableau.
export const SWITCH_PROFILES = [];
export const CGU_VERSION = 'alpha-3.0-2026-10';
// N° 46 · Cloudflare Turnstile (anti-robots) : clé PUBLIQUE du site (« Site Key »), faite pour être visible.
// Vide = pas de vérification. Ne l'activer dans Supabase (Authentication → Bot and Abuse Protection) qu'APRÈS l'avoir mise ici.
export const TURNSTILE_SITEKEY = '';
// Étape B · notifications : clé PUBLIQUE d'envoi (VAPID), faite pour être visible.
// La clé privée qui va avec n'est JAMAIS dans ce dépôt : elle est rangée dans Supabase (Edge Functions → Secrets).
export const VAPID_PUBLIC_KEY = 'BNQgN8MQbutsuDcCGinWQojb-1q1h1LBMGbHFK_GdZcr1v3LyYY4_9yLJvT32DxTIB6lcHjamaqoxOH5i_vHRBk';
