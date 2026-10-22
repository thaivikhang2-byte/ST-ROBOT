import { kits } from '../../data/kits.js';

export class KitService {
    async getKits() {
        // Mock API call
        return new Promise(resolve => {
            setTimeout(() => {
                resolve(kits);
            }, 100);
        });
    }
}
