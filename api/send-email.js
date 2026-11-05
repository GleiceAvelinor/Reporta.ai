// Vercel Serverless Function: Envio de Relatório via Resend API (Zero dependências externas)
export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido. Use POST.' });
  }

  try {
    const { to, cc, subject, html, pdfBase64, filename } = req.body;
    const RESEND_API_KEY = process.env.RESEND_API_KEY;

    if (!RESEND_API_KEY) {
      return res.status(400).json({ 
        error: 'Variável de ambiente RESEND_API_KEY não configurada na Vercel.' 
      });
    }

    if (!to || !subject) {
      return res.status(400).json({ error: 'Campos "to" e "subject" são obrigatórios.' });
    }

    const payload = {
      from: 'Reporta.AI <onboarding@resend.dev>', // Ou seu domínio verificado
      to: [to],
      subject: subject,
      html: html || '<p>Segue em anexo o Relatório Técnico de Campo gerado pelo Reporta.AI.</p>'
    };

    if (cc) {
      payload.cc = Array.isArray(cc) ? cc : [cc];
    }

    if (pdfBase64) {
      // Remover prefixo data:application/pdf;base64, se houver
      const base64Data = pdfBase64.replace(/^data:application\/pdf;base64,/, '');
      payload.attachments = [
        {
          filename: filename || 'Relatorio_Tecnico_Campo.pdf',
          content: base64Data
        }
      ];
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data });
    }

    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('Erro na função serverless:', error);
    return res.status(500).json({ error: error.message || 'Erro interno no envio.' });
  }
}

