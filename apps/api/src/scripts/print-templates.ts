import { printTemplatesForMetaConsole } from '../services/whatsapp/templates.js';

/**
 * Meta panelinde oluşturulacak şablonları yazdırır.
 *
 *     npm run whatsapp:templates --workspace=@berber/api
 *
 * Bot numarası hazır olduğunda bu çıktı developers.facebook.com'a
 * kopyalanır. Şablonlar onaylanmadan hatırlatma mesajları gönderilemez.
 */
process.stdout.write(`${printTemplatesForMetaConsole()}\n`);
