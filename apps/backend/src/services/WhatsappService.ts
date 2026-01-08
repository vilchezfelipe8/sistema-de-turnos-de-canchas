// src/services/WhatsappService.ts
import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';

class WhatsappService {
    private client: Client;
    private isReady: boolean = false;

    constructor() {
        this.client = new Client({
            authStrategy: new LocalAuth(), // Guarda la sesión para no escanear el QR siempre
            puppeteer: {
                args: ['--no-sandbox'], // Necesario para correr en servidores linux
            }
        });

        // Generar el QR en la terminal
        this.client.on('qr', (qr) => {
            console.log('📱 ESCANEA ESTE QR CON WHATSAPP:');
            qrcode.generate(qr, { small: true });
        });

        // Cuando ya está conectado
        this.client.on('ready', () => {
            this.isReady = true;
            console.log('✅ WhatsApp conectado y listo para enviar mensajes.');
        });

        this.client.initialize();

        process.once('SIGUSR2', async () => {
            console.log('🔄 Reiniciando WhatsApp por cambios en código...');
            try {
                await this.client.destroy(); // Cierra Chrome limpiamente
            } catch (e) {
                console.error('No se pudo cerrar Chrome, forzando...', e);
            }
            process.kill(process.pid, 'SIGUSR2'); // Continúa con el reinicio
        });

        process.on('SIGINT', async () => {
            console.log('🔴 Apagando WhatsApp correctamente...');
            await this.client.destroy();
            process.exit(0);
        });
    }

    async sendMessage(phoneNumber: string, message: string) {
        if (!this.isReady) {
            console.warn('⚠️ WhatsApp no está listo todavía.');
            return;
        }

        // Formatear el número: WhatsApp necesita el formato internacional sin +
        // Ej: Argentina 549 + area + numero -> 5493511234567@c.us
        // Aquí asumimos que recibes el número limpio, o tendrás que formatearlo.
        const chatId = `${phoneNumber}@c.us`; 

        try {
            await this.client.sendMessage(chatId, message);
            console.log(`Mensaje enviado a ${phoneNumber}`);
        } catch (error) {
            console.error('Error enviando mensaje de WhatsApp:', error);
        }
    }
}

// Exportamos una instancia única (Singleton)
export const whatsappService = new WhatsappService();