export const INVALID_VOICER_API_KEY_MESSAGE = "API-ключ Lumean содержит недопустимые символы. Скопируйте ключ целиком из кабинета Lumean и сохраните его в разделе Lumean.";

export function hasInvalidVoicerApiKeyCharacters(key: string): boolean {
  // HTTP-заголовок принимает ByteString и допускает внутренний TAB и байты obs-text.
  return /[\x00-\x08\x0a-\x1f\x7f\u0100-\uffff]/.test(key);
}
