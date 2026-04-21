import { Request, Response } from 'express';
import { ProductService } from '../services/ProductService';
import { ClubRepository } from '../repositories/ClubRepository';
import { sanitizeString } from '../utils/sanitize';

export class ProductController {
    private productService: ProductService;
    private clubRepository: ClubRepository;

    constructor() {
        this.productService = new ProductService();
        this.clubRepository = new ClubRepository();
    }

    // GET /api/clubs/:slug/products
    getAll = async (req: Request, res: Response) => {
        try {
            const { slug } = req.params;
            const club = await this.clubRepository.findBySlug(slug as string);
            if (!club) return res.status(404).json({ error: 'Club no encontrado' });

            const products = await this.productService.getProductsByClub(club.id);
            res.json(products);
        } catch (error) {
            res.status(500).json({ error: 'Error al obtener productos' });
        }
    }

    // POST /api/clubs/:slug/products
    create = async (req: Request, res: Response) => {
        try {
            const { slug } = req.params;
            const { name, price, stock, category, isCombo, components } = req.body;
            
            const club = await this.clubRepository.findBySlug(slug as string);
            if (!club) return res.status(404).json({ error: 'Club no encontrado' });

            const newProduct = await this.productService.createProduct(club.id, {
                name: sanitizeString(String(name ?? ''), 200),
                price: Number(price),
                stock: Number(stock ?? 0),
                category: category ? sanitizeString(String(category), 100) : undefined,
                isCombo: Boolean(isCombo),
                components: Array.isArray(components) ? components : []
            });
            res.status(201).json(newProduct);
        } catch (error) {
            console.error(error);
            const message = error instanceof Error ? error.message : 'Error al crear producto';
            res.status(400).json({ error: message });
        }
    }

    // PUT /api/clubs/:slug/products/:id
    update = async (req: Request, res: Response) => {
        try {
            const { slug } = req.params;
            const { id } = req.params;
            const data = req.body;
            const club = await this.clubRepository.findBySlug(slug as string);
            if (!club) return res.status(404).json({ error: 'Club no encontrado' });

            const updateData: any = {
                ...data,
                price: data.price !== undefined ? Number(data.price) : undefined,
                stock: data.stock !== undefined ? Number(data.stock) : undefined,
                isCombo: data.isCombo !== undefined ? Boolean(data.isCombo) : undefined,
                components: Array.isArray(data.components) ? data.components : undefined
            };
            if (data.name != null) updateData.name = sanitizeString(String(data.name), 200);
            if (data.category != null) updateData.category = sanitizeString(String(data.category), 100);

            const updatedProduct = await this.productService.updateProductByClub(Number(id), club.id, updateData);
            if (!updatedProduct) return res.status(404).json({ error: 'Producto no encontrado' });
            res.json(updatedProduct);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Error al actualizar producto';
            res.status(400).json({ error: message });
        }
    }

    // DELETE /api/clubs/:slug/products/:id
    delete = async (req: Request, res: Response) => {
        try {
            const { slug } = req.params;
            const { id } = req.params;
            const club = await this.clubRepository.findBySlug(slug as string);
            if (!club) return res.status(404).json({ error: 'Club no encontrado' });

            const deleted = await this.productService.deleteProductByClub(Number(id), club.id);
            if (!deleted) return res.status(404).json({ error: 'Producto no encontrado' });

            res.json({ message: 'Producto eliminado' });
        } catch (error) {
            res.status(500).json({ error: 'Error al eliminar producto' });
        }
    }
}