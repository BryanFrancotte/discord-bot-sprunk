'use strict';

class TicketLogService {
    constructor(store) {
        this.store = store;
    }

    async add(entry) {
        await this.store.update(data => {
            if (!Array.isArray(data.tickets)) data.tickets = [];
            data.tickets.unshift(entry);
            data.tickets = data.tickets.slice(0, 500);
        });
    }
}

module.exports = TicketLogService;
