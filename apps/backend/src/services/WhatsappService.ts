// src/services/WhatsappService.ts
import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';

class WhatsappService {
    private client: Client;
    private isReady: boolean = false;

    constructor() {
        this.client = new Client({
    authStrategy: new LocalAuth({
        dataPath: './.wwebjs_auth' 
    }),
    puppeteer: {
        headless: true,
        
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', 
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--disable-gpu'
        ],
        timeout: 60000 
    }
});

        // Generar el QR en la terminal
        this.client.on('qr', (qr) => {
            qrcode.generate(qr, { small: true });
        });

        // Cuando ya está conectado
        this.client.on('ready', () => {
            this.isReady = true;
        });

        // Manejo de desconexión para evitar procesos zombies
        this.client.on('disconnected', () => {
             this.isReady = false;
        });

        this.client.initialize();

        // --- MANEJO DE CIERRE LIMPIO (IGUAL QUE ANTES) ---
        process.once('SIGUSR2', async () => {
            try {
                await this.client.destroy(); 
            } catch (e) {
                console.error('No se pudo cerrar Chrome, forzando...', e);
            }
            process.kill(process.pid, 'SIGUSR2'); 
        });

        process.on('SIGINT', async () => {
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
            return;
        }

        // Formatear el número (simple)
        // Asegúrate que phoneNumber venga como "549351..." sin el "+"
        const chatId = `${phoneNumber}@c.us`; 

        try {
            await this.client.sendMessage(chatId, message, {sendSeen: false});
        } catch (error) {
            console.error('❌ Error enviando mensaje de WhatsApp:', error);
        }
    }
}

export const whatsappService = new WhatsappService();