import { Request, Response } from 'express';
import { ClubService } from '../services/ClubService';

export class ClubController {
    constructor(private clubService: ClubService) {}

    createClub = async (req: Request, res: Response) => {
        try {
            const { name, address, contact } = req.body;
            const club = await this.clubService.createClub(name, address, contact);
            res.status(201).json(club);
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    }

    createCourt = async (req: Request, res: Response) => {
        try {
            const { clubId, name, surface, activityIds } = req.body;
            const court = await this.clubService.registerCourt(clubId, name, surface, activityIds);
            res.status(201).json(court);
        } catch (error: any) {
            res.status(400).json({ error: error.message });
        }
    }
}