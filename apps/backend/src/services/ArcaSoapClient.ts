import { parseStringPromise, processors } from 'xml2js';
import { arcaConfig, ArcaEnvironment } from '../utils/arcaConfig';

const parseXml = (xml: string) =>
  parseStringPromise(xml, {
    explicitArray: false,
    ignoreAttrs: false,
    tagNameProcessors: [processors.stripPrefix]
  });

const buildEnvelope = (body: string) =>
  `<?xml version="1.0" encoding="utf-8"?>` +
  `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
  `<soap:Body>${body}</soap:Body>` +
  `</soap:Envelope>`;

const normalizeText = (value: unknown) => String(value || '').trim();

export class ArcaSoapClient {
  async loginCms(environment: ArcaEnvironment, cms: string) {
    const url = arcaConfig.getWsaaUrl(environment);
    const body = `<loginCms xmlns="http://wsaa.view.sua.dvadac.desein.afip.gov.ar/">` +
      `<in0>${cms}</in0>` +
      `</loginCms>`;

    const xml = buildEnvelope(body);
    const responseText = await this.postSoap(url, xml, 'loginCms');
    const parsed = await parseXml(responseText);
    const loginCmsReturn = normalizeText(parsed?.Envelope?.Body?.loginCmsResponse?.loginCmsReturn);
    if (!loginCmsReturn) {
      throw new Error('WSAA respuesta vacia');
    }

    const ticket = await parseXml(loginCmsReturn);
    const credentials = ticket?.loginTicketResponse?.credentials || {};

    return {
      token: normalizeText(credentials?.token),
      sign: normalizeText(credentials?.sign),
      expirationTime: normalizeText(ticket?.loginTicketResponse?.header?.expirationTime)
    };
  }

  async feCompUltimoAutorizado(environment: ArcaEnvironment, payloadXml: string) {
    const url = arcaConfig.getWsfeUrl(environment);
    const xml = buildEnvelope(payloadXml);
    const responseText = await this.postSoap(url, xml, 'FECompUltimoAutorizado');
    const parsed = await parseXml(responseText);
    return parsed?.Envelope?.Body?.FECompUltimoAutorizadoResponse?.FECompUltimoAutorizadoResult || null;
  }

  async feCAESolicitar(environment: ArcaEnvironment, payloadXml: string) {
    const url = arcaConfig.getWsfeUrl(environment);
    const xml = buildEnvelope(payloadXml);
    const responseText = await this.postSoap(url, xml, 'FECAESolicitar');
    const parsed = await parseXml(responseText);
    return parsed?.Envelope?.Body?.FECAESolicitarResponse?.FECAESolicitarResult || null;
  }

  private async postSoap(url: string, body: string, action: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), arcaConfig.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: action
        },
        body,
        signal: controller.signal
      });

      const text = await response.text();
      if (!response.ok) {
        throw new Error(`ARCA SOAP ${action} fallo: ${response.status}`);
      }
      return text;
    } finally {
      clearTimeout(timeout);
    }
  }
}
