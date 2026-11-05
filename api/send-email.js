// Vercel Serverless Function: Envio de Relatório via Resend API
// Camada de Segurança Reforçada: Rate Limiting em memória, Sanitização e Validação Rigorosa

// Rate Limiting simples em memória por IP (Janela de 1 minuto)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minuto
const MAX_REQUESTS_PER_WINDOW = 5;   // Máx 5 envios por minuto por IP

// Validador de formato de e-mail RFC 5322 simplificado
function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  const re = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return re.test(email.trim()) && email.length <= 254;
}

// Sanitização básica contra injeção em cabeçalhos (Header Injection / CRLF)
function sanitizeHeader(val) {
  if (typeof val !== 'string') return '';
  return val.replace(/[\r\n]/g, '').trim().slice(0, 150);
}

// Sanitização de HTML simples para prevenir injeções perigosas
function sanitizeHtmlContent(html) {
  if (typeof html !== 'string') return '';
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .slice(0, 10000);
}

export default async function handler(req, res) {
  // CORS Seguro
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido. Utilize POST.' });
  }

  // 1. Defesa contra Abuso (Rate Limiting por IP)
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
                   req.socket?.remoteAddress || 
                   'unknown';

  const now = Date.now();
  const clientData = rateLimitMap.get(clientIp) || { count: 0, resetTime: now + RATE_LIMIT_WINDOW };

  if (now > clientData.resetTime) {
    clientData.count = 0;
    clientData.resetTime = now + RATE_LIMIT_WINDOW;
  }

  clientData.count++;
  rateLimitMap.set(clientIp, clientData);

  // Limpeza preventiva do map para evitar vazamento de memória
  if (rateLimitMap.size > 2000) {
    rateLimitMap.clear();
  }

  if (clientData.count > MAX_REQUESTS_PER_WINDOW) {
    return res.status(429).json({ 
      error: 'Muitas requisições em pouco tempo. Por segurança, aguarde 1 minuto para reenviar.' 
    });
  }

  try {
    const { to, cc, subject, html, pdfBase64, filename } = req.body || {};
    const RESEND_API_KEY = process.env.RESEND_API_KEY;

    if (!RESEND_API_KEY) {
      return res.status(500).json({ 
        error: 'Serviço de e-mail não inicializado. Chave de API ausente.' 
      });
    }

    // 2. Validação Estrita dos Parâmetros de Entrada
    if (!to || !isValidEmail(to)) {
      return res.status(400).json({ error: 'E-mail de destino (to) inválido ou ausente.' });
    }

    if (cc && !isValidEmail(cc)) {
      return res.status(400).json({ error: 'E-mail de cópia (cc) inválido.' });
    }

    if (!subject || typeof subject !== 'string' || subject.trim().length === 0) {
      return res.status(400).json({ error: 'O assunto da mensagem é obrigatório.' });
    }

    // 3. Sanitização contra CRLF Injection
    const safeSubject = sanitizeHeader(subject);
    const safeFilename = sanitizeHeader(filename || 'Relatorio_Tecnico.pdf').replace(/[^a-zA-Z0-9_.-]/g, '_');
    const safeHtml = sanitizeHtmlContent(html || '<p>Segue em anexo o Relatório Técnico de Atividades gerado pelo Reporta.AI.</p>');

    const payload = {
      from: 'Reporta.AI <onboarding@resend.dev>',
      to: [to.trim().toLowerCase()],
      subject: safeSubject,
      html: safeHtml
    };

    if (cc && isValidEmail(cc)) {
      payload.cc = [cc.trim().toLowerCase()];
    }

    // 4. Validação e Controle do Tamanho do Anexo PDF
    if (pdfBase64) {
      if (typeof pdfBase64 !== 'string') {
        return res.status(400).json({ error: 'Formato do anexo inválido.' });
      }

      // Estimar tamanho (Base64 não deve exceder ~15MB)
      if (pdfBase64.length > 20 * 1024 * 1024) {
        return res.status(413).json({ error: 'O arquivo anexado excede o limite máximo permitido (15MB).' });
      }

      const base64Data = pdfBase64.replace(/^data:application\/pdf;base64,/, '');
      payload.attachments = [
        {
          filename: safeFilename.endsWith('.pdf') ? safeFilename : `${safeFilename}.pdf`,
          content: base64Data
        }
      ];
    }

    // 5. Despacho Seguro via API Resend
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ 
        error: data.message || data.name || 'Falha ao despachar mensagem pelo provedor.' 
      });
    }

    return res.status(200).json({ success: true, id: data.id });
  } catch (error) {
    console.error('Erro na execução segura:', error);
    return res.status(500).json({ error: 'Erro interno ao processar requisição de envio.' });
  }
}
