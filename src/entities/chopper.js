class Hitbox {
    constructor(x, y, radius) {
        this.x = x;
        this.y = y;
        this.radius = radius;
        this.isLanding = false;
        this.readjusted = false;
        this.vital = false;
    }
}

class Chopper extends Entity {

    constructor(facing = 1) {
        super();

        this.buckets.push('chopper');

        this.controls = {
            up: false,
            down: false,
            left: false,
            right: false,
            shoot: false,
        };

        this.radius = 35;

        this.lastShot = 0;
        this.shotInterval = 1;

        this.facing = facing;

        this.simplifiedPhysics = false;

        this.hitBoxes = [
            new Hitbox(-10, 18, 5),
            new Hitbox(10, 18, 5),

            // Top
            new Hitbox(20, -15, 20),
            new Hitbox(-20, -15, 20),

            // Front (nose)
            new Hitbox(15, 0, 10),

            // Back propeller
            new Hitbox(-55, -10, 10),
        ];

        for (const hitbox of this.hitBoxes) {
            hitbox.x *= this.facing;
        }

        for (const landingHitbox of [
            this.hitBoxes[0],
            this.hitBoxes[1],
        ]) {
            landingHitbox.isLanding = true;
        }

        for (const hitbox of this.hitBoxes) {
            hitbox.vital = !hitbox.isLanding;
        }

        this.globalHitBoxes = [];

        this.propellerPower = 0;
        this.momentum = {x: 0, y: 0, angle: 0};

        this.landed = false;
        this.landedTime = 0;
        this.lastLanded = 0;

        this.damagedStart = 0;
        this.damagedEnd = 0;

        this.lockedTarget = null;
        this.lockedTargetFactor = 0;
        this.lockedTargetAcquireAngle = PI / 8;
        this.lockedTargetKeepAngle = PI / 4;

        this.lastCollisionSound = 0;
    }

    updateGlobalHitboxes() {
        for (let i = 0 ; i < this.hitBoxes.length ; i++) {
            if (!this.globalHitBoxes[i]) {
                this.globalHitBoxes[i] = new Hitbox(0, 0, 0);
            }

            const hitBox = this.hitBoxes[i];
            const hitBoxAngle = Math.atan2(hitBox.y, hitBox.x);
            const dist = distP(0, 0, hitBox.x, hitBox.y);
            this.globalHitBoxes[i].x = this.x + Math.cos(this.angle + hitBoxAngle) * dist;
            this.globalHitBoxes[i].y = this.y + Math.sin(this.angle + hitBoxAngle) * dist;
            this.globalHitBoxes[i].radius = hitBox.radius;
            this.globalHitBoxes[i].isLanding = hitBox.isLanding;
            this.globalHitBoxes[i].vital = hitBox.vital;
            this.globalHitBoxes[i].readjusted = false;
        }
    }

    get averagePoint() {
        let x = 0, y = 0;
        for (const hitBox of this.globalHitBoxes) {
            x += hitBox.x;
            y += hitBox.y;
        }
        return {
            x: x / this.hitBoxes.length,
            y: y / this.hitBoxes.length,
        };
    }

    get readyToShoot() {
        if (this.age < this.damagedEnd) return false;
        return this.age - this.lastShot > this.shotInterval;
    }

    shootingTarget() {
        if (!this.readyToShoot) return null;

        let { angle } = this;
        if (this.facing < 0) {
            angle = atan2(sin(angle), -cos(angle));
        }

        let bestTarget;
        let bestTargetAngleDiff = this.lockedTargetAcquireAngle;
        for (const target of targets(this.world, this)) {
            if (dist(target, this) > 600) continue;
            if (target instanceof Prisoner) continue; // Don't lock on prisoners
            if (target instanceof Rebel && !this.buckets.includes('player')) continue; // Dear reader, please don't judge me
            const angleToTarget = normalize(angleBetween(this, target));

            const angleDiff = abs(normalize(angleToTarget - normalize(angle)));
            if (target === this.lockedTarget && angleDiff < this.lockedTargetKeepAngle) {
                return target;
            }

            if (angleDiff < bestTargetAngleDiff) {
                bestTarget = target;
                bestTargetAngleDiff = angleDiff;
            }
        }

        return bestTarget;
    }

    cycle(elapsed) {
        super.cycle(elapsed);

        for (const chopper of this.world.bucket('chopper')) {
            if (chopper === this) continue;
            if (dist(chopper, this) > this.radius) continue;
            this.push();
            chopper.push();

            if (this.age - this.lastCollisionSound > 0.2) {
                this.lastCollisionSound = this.age;
                sound(...[,,63,.05,.2,.3,4,,,6,,,.15,1.3,,.1,,.32,.15,.01]); // Explosion 424
            }
        }

        // Target lock on
        const bestTarget = this.shootingTarget();
        if (bestTarget !== this.lockedTarget) {
            this.lockedTarget = bestTarget;
            this.lockedTargetFactor = 0;
        }

        if (this.lockedTarget) {
            this.lockedTargetFactor = min(
                1,
                this.lockedTargetFactor + elapsed,
            );
        }

        // Shooting
        if (this.readyToShoot && this.controls.shoot) {
            const missile = new Missile(this);
            this.world.add(missile);

            if (this.lockedTarget && this.lockedTargetFactor >= 1) {
                missile.angle = angleBetween(this, this.lockedTarget);
                if (this.buckets.includes('player')) { // Boy this is ugly, please forgive me for my sin
                    missile.target = this.lockedTarget;
                }
            }

            this.lastShot = this.age;
        }

        this.updateGlobalHitboxes();

        const { averagePoint } = this;

        for (const obstacle of this.world.bucket('obstacle')) {
            if (!isBetween(obstacle.minX - 100, this.x, obstacle.maxX + 100)) continue;

            for (const hitBox of this.globalHitBoxes) {
                hitBox.readjusted = hitBox.readjusted || obstacle.pushAway(hitBox);
            }
        }

        const landed = !this.globalHitBoxes.some(hitBox => hitBox.isLanding && !hitBox.readjusted);
        let crashed = this.globalHitBoxes.some(hitBox => hitBox.vital && hitBox.readjusted);

        for (const water of this.world.bucket('water')) {
            if (this.y >= water.y) {
                crashed = true;
            }
        }

        if (crashed) {
            this.explode();
            return;
        }

        const newAverage = this.averagePoint;

        const dX = newAverage.x - averagePoint.x;
        const dY = newAverage.y - averagePoint.y;

        if (dX || dY) {
            this.x += dX;
            this.y += dY;
        }

        if (this.age >= this.damagedEnd) {
            let x = 0, y = 0;
            if (this.controls.left) x -= 1;
            if (this.controls.right) x += 1;
            if (this.controls.up) y -= 1;
            if (this.controls.down) y += 1;

            const targetPower = this.controls.up ? 1 : 0;
            this.propellerPower += between(
                -elapsed * 4,
                targetPower - this.propellerPower,
                elapsed * 4,
            );

            let idealAngle = 0;
            let angleVelocity = PI / 6;
            if (!landed) {
                if (this.controls.left) idealAngle = -PI / 4;
                if (this.controls.right) idealAngle = PI / 4;
                if (this.controls.left || this.controls.right) angleVelocity = PI / 2;
            }

            this.angle += between(
                -elapsed * angleVelocity,
                idealAngle - this.angle,
                elapsed * angleVelocity
            );
        } else {
            const x = this.x + rnd(-20, 20);
            const y = this.y + rnd(-20, 20);
            const particle = new Particle(
                pick(['#000', '#ff0', '#f80', '#f00']),
                [rnd(10, 20), 0],
                [x, x + rnd(-100, 100)],
                [y, y - rnd(50, 150)],
                rnd(1.2, 3),
            );
            this.world.add(particle);
        }
        this.momentum.angle = 0;

        if (this.propellerPower) {
            this.momentum.x += this.propellerPower * Math.cos(this.angle - PI / 2) * elapsed * 400 * 1.5;
            this.momentum.y += this.propellerPower * Math.sin(this.angle - PI / 2) * elapsed * 400;
        }

        const opposition = Math.sign(Math.sin(this.angle)) !== Math.sign(this.momentum.x) || this.simplifiedPhysics
            ? 200
            : 50;
        this.momentum.x += between(
            -elapsed * opposition,
            -this.momentum.x,
            elapsed * opposition,
        );

        const maxFallSpeed = this.simplifiedPhysics ? 100 : 400;
        this.momentum.y += between(
            -elapsed * (this.simplifiedPhysics ? 100 : 200),
            maxFallSpeed - this.momentum.y,
            elapsed * (this.simplifiedPhysics ? 200 : 150),
        );

        if (landed && !this.propellerPower) {
            this.momentum.y = 0;
        }

        this.x += this.momentum.x * elapsed;
        this.y += this.momentum.y * elapsed;
        this.angle += this.momentum.angle * elapsed;

        const camera = firstItem(this.world.bucket('camera'));
        // this.x = between(camera.minX, this.x, camera.maxX);
        // this.y = between(camera.minY, this.y, camera.maxY);

        this.angle = between(-PI / 4, this.angle, PI / 4);

        const wasLanded = this.landed;
        const { lastLanded } = this;
        this.landed = landed;
        if (this.landed) {
            this.lastLanded = this.age;
            this.landedTime += elapsed;
        } else {
            this.landedTime = 0;
        }

        if (this.landed && !wasLanded && this.age - lastLanded > 0.5) {
            const [a, b] = this.globalHitBoxes.filter(hitBox => hitBox.isLanding);

            for (let i = 0 ; i < 10 ; i++) {
                const ratio = rnd(-0.5, 1.5);
                const x = a.x + ratio * (b.x - a.x);
                const y = a.y + ratio * (b.y - a.y);
                const particle = new Particle(
                    '#fff',
                    [rnd(10, 15), 0],
                    [x, x + rnd(-30, 30)],
                    [y, y + rnd(-20, -10)],
                    rnd(0.8, 1.5),
                );
                this.world.add(particle);
            }

            sound(...[0.5,,400,.02,.08,.09,4,2.5,-1,9,,,,.3,,.1,.14,.63,.02,,-2063]); // Hit 200
        }

        if (!isBetween(camera.minX, this.x, camera.maxX)) {
            this.momentum.x = 0;
            this.x = between(camera.minX, this.x, camera.maxX);
        }

        if (!isBetween(camera.minY, this.y, camera.maxY)) {
            this.momentum.y = 0;
            this.y = between(camera.minY, this.y, camera.maxY);
        }
    }

    push(duration = 1) {
        const angle = rnd(PI / 4, PI * 3 / 4);
        this.momentum.x = cos(angle) * 300;
        this.momentum.y = sin(angle) * 300;

        this.damagedStart = this.age;
        this.damagedEnd = this.age + duration * (this.simplifiedPhysics ? 0.5 : 1);
    }

    explode() {
        this.world.remove(this);
        this.destroy();
        explosion(this.world, this, 80, this);
    }

    render() {
        ctx.wrap(() => {
            ctx.translate(this.x, this.y);
            ctx.rotate(this.angle);
            ctx.scale(this.facing, 1);

            // Spin around when damaged
            if (this.age < this.damagedEnd) {
                const ratio = (this.age - this.damagedStart) / (this.damagedEnd - this.damagedStart);
                ctx.scale(cos(ratio * PI * 2), 1);
            }

            ctx.fillStyle = '#000';
            ctx.fillRect(-20, -15, 40, 30);

            ctx.fillRect(0, -10, -50, 5);
            ctx.fillRect(-60, -20, 10, 15);

            ctx.fillRect(-20, 20, 40, 2);
            ctx.fillRect(-10, 15, 2, 5);
            ctx.fillRect(10, 15, 2, 5);


            ctx.fillRect(-2, 0, 4, -22);

            ctx.wrap(() => {
                ctx.translate(0, -22);
                ctx.scale(1, 0.45);
                ctx.rotate(this.age * PI * 4);
                ctx.fillRect(-50, -3, 100, 6);
            });

            ctx.wrap(() => {
                ctx.translate(-55, -15);
                ctx.rotate(this.age * PI * 4);
                ctx.fillRect(-12, -2, 24, 4);
            });

            // ctx.strokeStyle = '#fff';
            // ctx.beginPath();
            // ctx.moveTo(0, 0);
            // ctx.lineTo(100, 0);
            // ctx.stroke();
        });

        // ctx.wrap(() => {
        //     ctx.translate(this.x, this.y);
        //     ctx.fillStyle = '#fff';
        //     ctx.translate(0, 50);
        //     for (const line of [
        //         `propeller: ${Math.round(this.propellerPower * 100)}`,
        //         `momentum: ${Math.round(this.momentum.x)},${Math.round(this.momentum.y)},${this.momentum.angle}`,
        //     ]) {
        //         ctx.fillText(line, 0, 0);
        //         ctx.translate(0, 20);
        //     }
        // });

        // for (const hitBox of this.globalHitBoxes) {
        //     ctx.fillStyle = hitBox.readjusted ? '#ff0' : '#0f0';
        //     ctx.beginPath();
        //     ctx.arc(hitBox.x, hitBox.y, hitBox.radius, 0, Math.PI * 2);
        //     ctx.fill();
        // }

        // const { averagePoint } = this;
        // ctx.fillStyle = '#00f';
        // ctx.fillRect(averagePoint.x - 2, averagePoint.y - 2, 4, 4);

        // const future = this.futurePosition();

        // ctx.strokeStyle = '#ff0';
        // ctx.lineWidth = 4;
        // ctx.beginPath();
        // ctx.moveTo(this.x, this.y);
        // ctx.lineTo(future.x, future.y);
        // ctx.stroke();
    }

    crashed() {
        return this.world.waitFor(() => {
            if (!this.world.contains(this)) throw new Error();
        })
    }

    futurePosition() {
        const x = this.x + this.momentum.x * 1;
        const y = this.y + this.momentum.y * 1;
        return { x, y };
    }
}
