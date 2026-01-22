// src/services/WhatsappService.ts
import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';

class WhatsappService {
    private client: Client;
    private isReady: boolean = false;
    private currentQR: string | null = null;

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

        // Guardar el QR y también mostrarlo en la terminal
        this.client.on('qr', (qr) => {
            this.currentQR = qr;
            console.log('📱 Nuevo QR generado. Accede a /whatsapp/qr para verlo en el navegador');
            // También mostrarlo en terminal por si acaso
            qrcode.generate(qr, { small: true });
        });

        // Cuando ya está conectado
        this.client.on('ready', () => {
            this.isReady = true;
            this.currentQR = null; // Limpiar QR cuando está listo
            console.log('✅ WhatsApp conectado y listo');
        });

        // Manejo de desconexión para evitar procesos zombies
        this.client.on('disconnected', () => {
             this.isReady = false;
             this.currentQR = null;
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

    getQR(): string | null {
        return this.currentQR;
    }

    getStatus(): { ready: boolean; hasQR: boolean } {
        return {
            ready: this.isReady,
            hasQR: this.currentQR !== null
        };
    }
}

export const whatsappService = new WhatsappService();