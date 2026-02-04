import { Request, Response } from 'express';
import { ProductService } from '../services/ProductService';
import { ClubRepository } from '../repositories/ClubRepository'; // Asegurate de tener esto o usar Prisma directo para validar el club

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
            const { name, price, stock, category } = req.body;
            
            const club = await this.clubRepository.findBySlug(slug as string);
            if (!club) return res.status(404).json({ error: 'Club no encontrado' });

            const newProduct = await this.productService.createProduct(club.id, { name, price, stock, category });
            res.status(201).json(newProduct);
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: 'Error al crear producto' });
        }
    }

    // PUT /api/clubs/:slug/products/:id
    update = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            const data = req.body;
            const updatedProduct = await this.productService.updateProduct(Number(id), data);
            res.json(updatedProduct);
        } catch (error) {
            res.status(500).json({ error: 'Error al actualizar producto' });
        }
    }

    // DELETE /api/clubs/:slug/products/:id
    delete = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            await this.productService.deleteProduct(Number(id));
            res.json({ message: 'Producto eliminado' });
        } catch (error) {
            res.status(500).json({ error: 'Error al eliminar producto' });
        }
    }
}