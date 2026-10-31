// Pocket Club · réglages généraux de l'application.
// Le nom n'est pas définitif : il n'est écrit qu'ici (et dans manifest.webmanifest, lu par les téléphones à l'installation).
export const BRAND = { name: 'Pocket Club', word1: 'p', word2: 'cket', word3: 'club', slogan: '', contact: 'gael.monblason@gmail.com', editor: 'Gaël Raveneau (particulier)' };
// Adresse et clé publique du projet Supabase. La clé « publishable » est faite pour être visible :
// les données sont protégées par les règles d'accès (RLS) de la base.
export const SUPABASE_URL = 'https://rmdszovbpmagtvugfrpr.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_KsSQGA_bD3QSpX1vjnYjUw_eYBXXJ2u';
export const VERSION = 'alpha 3.2';
export const CGU_VERSION = 'alpha-3.0-2026-10';
// N° 46 · Cloudflare Turnstile (anti-robots) : clé PUBLIQUE du site (« Site Key »), faite pour être visible.
// Vide = pas de vérification. Ne l'activer dans Supabase (Authentication → Bot and Abuse Protection) qu'APRÈS l'avoir mise ici.
export const TURNSTILE_SITEKEY = '';
