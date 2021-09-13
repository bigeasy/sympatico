const assert = require('assert')

const { Queue } = require('avenue')

const { Future } = require('perhaps')

class Bucket {
    static Idle = class {
        constructor (bucket) {
            this.bucket = bucket
            this.promise = null
            this.majority = null
            this.active = false
        }

        distribution (distribution, future) {
            assert.equal(distribution.departed.length, 0, 'bootstrapping on departure')
            return new Bucket.Bootstrap(this.bucket, distribution, future)
        }

        receive (message) {
            switch (message.method) {
            case 'split': {
                    // Would go to stable.
                }
                break
            }
        }
    }

    static Departed = class {
        constructor (bucket, majority, departed) {
            this.bucket = bucket
            this.departed = departed
            this.majority = majority
            this.bucket.events.push([{
                method: 'departure',
                to: majority[0],
                majority: majority,
                departed: departed
            }])
        }
    }

    static Bootstrap = class {
        constructor (bucket, distribution, future) {
            const instances = distribution.to.instances.concat(distribution.to.instances)
            this.step = 0
            this.majority = instances.slice(bucket.index, bucket.index + Math.min(distribution.to.instances.length, bucket.majoritySize))
                                     .map(promise => { return { promise, index: bucket.index } })
            this.bucket = bucket
            this.future = future
            this.distribution = distribution
            this.bucket.events.push({
                step: this.step++,
                majority: this.majority.slice(0, 1)
            })
        }

        depart (promise) {
            const departed = this.majority.filter(address => address.promise != promise)
            if (departed.length != this.majority.length) {
                return new Departed(this.bucket, departed, [ promise ])
            }
            return this
        }

        complete (step) {
            assert.equal(step + 1, this.step, 'step out of order')
            if (this.step == this.majority.length) {
                this.future.resolve()
                return new Bucket.Stable(this.bucket)
            }
            const current = this.step++
            this.bucket.events.push({ step: current, majority: this.majority.slice(0, this.step) })
            return this
        }
    }

    static Join = class {
        constructor (promise, majority) {
            this.promise = promise
            this.majority = majority
        }
    }

    static Stable = class {
        constructor (bucket) {
            this.bucket = bucket
        }

        distribution (distribution, future) {
            if (distribution.to.majority.length > distribution.from.majority.length) {
                return new Bucket.Expand(this.bucket, distribution, future)
            }
            return new Bucket.Migrate(this.bucket, distribution, future)
        }
    }

    static Expand = class {
        constructor (bucket, distribution, future) {
            this.bucket = bucket
            this.distribution = distribution
            this.future = future
            const instances = distribution.to.instances.concat(distribution.to.instances)
            const majority = instances.slice(bucket.index, bucket.index + Math.min(distribution.to.instances.length, bucket.majoritySize))
            this.left = majority.map(promise => { return { promise, index: bucket.index } })
            this.right = majority.map(promise => { return { promise, index: bucket.index + distribution.from.majority.length } })
            // Until the instance count grows to double the majority size, we
            // will have some overlap.
            const combined = this.left.concat(this.right)
            this.state = 'replicating'
            this.bucket.events.push([{ method: 'replicate', majority: combined, to: [ combined[0] ] }])
        }

        depart (promise) {
            if (this.left.some(address => address.promise == promise)) {
                switch (this.state) {
                case 'replicating': {
                        return [{ method: 'depart', majority: this.left, to: this.left[0] }]
                    }
                    break
                case 'splitting': {
                        return [{ method: 'depart', majority: this.left, to: this.left[0] }]
                    }
                    break
                }
            }
        }

        request (message) {
        }

        response (message) {
        }

        complete (method) {
            switch (method) {
            case 'replicate': {
                    this.bucket.events.push([{
                        method: 'split',
                        to: this.left[0],
                        majority: this.left
                    }, {
                        method: 'split',
                        to: this.right[0],
                        majority: this.right
                    }])
                    return this
                }
            case 'split': {
                    this.future.resolve()
                    return new Bucket.Stable(this.bucket)
                }
            }
        }
    }

    constructor (index, majoritySize) {
        this.index = index
        this.majoritySize = majoritySize
        this.events = new Queue
        this._strategy = new Bucket.Idle(this)
    }

    get active () {
        return this._strategy.active
    }

    get promise () {
        return this._strategy.promise
    }

    get majority () {
        return this._strategy.majority
    }

    distribution (distribution) {
        const future = new Future
        this._strategy = this._strategy.distribution(distribution, future)
        return future
    }

    bootstrap (promise, majority) {
        return this._strategy = new Bucket.Bootstrap(this, promise, majority)
    }

    complete (step) {
        this._strategy = this._strategy.complete(step)
    }

    expand (majority) {
        assert.equal(majority.filter(address => ~this.majority.indexOf(address)).length, this.majority.length)
    }
}

module.exports = Bucket
