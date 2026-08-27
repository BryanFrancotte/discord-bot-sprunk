'use strict';

const fs = require('fs');

class InstanceLock {
    constructor(lockPath) {
        this.lockPath = lockPath;
        this.acquired = false;
    }

    acquire() {
        try {
            const descriptor = fs.openSync(this.lockPath, 'wx');
            fs.writeFileSync(descriptor, String(process.pid), 'utf8');
            fs.closeSync(descriptor);
            this.acquired = true;
            return;
        } catch (error) {
            if (error.code !== 'EEXIST') throw error;
        }

        const oldPid = Number.parseInt(fs.readFileSync(this.lockPath, 'utf8'), 10);
        if (Number.isInteger(oldPid) && this.isProcessAlive(oldPid)) {
            throw new Error(`Le bot est déjà lancé avec le PID ${oldPid}.`);
        }

        fs.unlinkSync(this.lockPath);
        this.acquire();
    }

    isProcessAlive(pid) {
        try {
            process.kill(pid, 0);
            return true;
        } catch (error) {
            return error.code === 'EPERM';
        }
    }

    release() {
        if (!this.acquired || !fs.existsSync(this.lockPath)) return;

        try {
            const lockPid = fs.readFileSync(this.lockPath, 'utf8').trim();
            if (lockPid === String(process.pid)) fs.unlinkSync(this.lockPath);
        } finally {
            this.acquired = false;
        }
    }
}

module.exports = InstanceLock;
