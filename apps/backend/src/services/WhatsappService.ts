// src/services/WhatsappService.ts
import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';

class WhatsappService {
    private client: Client;
    private isReady: boolean = false;

    constructor() {
        this.client = new Client({
            authStrategy: new LocalAuth(),
            
            
            puppeteer: {
                protocolTimeout: 120000,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu'
                ],
                headless: true 
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

        // Manejo de desconexión para evitar procesos zombies
        this.client.on('disconnected', (reason) => {
             console.log('❌ WhatsApp desconectado:', reason);
             this.isReady = false;
        });

        this.client.initialize();

        // --- MANEJO DE CIERRE LIMPIO (IGUAL QUE ANTES) ---
        process.once('SIGUSR2', async () => {
            console.log('🔄 Reiniciando WhatsApp por cambios en código...');
            try {
                await this.client.destroy(); 
            } catch (e) {
                console.error('No se pudo cerrar Chrome, forzando...', e);
            }
            process.kill(process.pid, 'SIGUSR2'); 
        });

        process.on('SIGINT', async () => {
            console.log('🔴 Apagando WhatsApp correctamente...');
            try {
                await this.client.destroy();
            } catch (e) {
                console.error('Error cerrando cliente:', e);
            }
            process.exit(0);
        });
    }

    async sendMessage(phoneNumber: string, message: string) {
        if (!this.isReady) {
            console.warn('⚠️ WhatsApp no está listo todavía. Mensaje encolado o perdido.');
            return;
        }

        // Formatear el número (simple)
        // Asegúrate que phoneNumber venga como "549351..." sin el "+"
        const chatId = `${phoneNumber}@c.us`; 

        try {
            await this.client.sendMessage(chatId, message, {sendSeen: false});
            console.log(`✅ Mensaje enviado a ${phoneNumber}`);
        } catch (error) {
            console.error('❌ Error enviando mensaje de WhatsApp:', error);
        }
    }
}

export const whatsappService = new WhatsappService();