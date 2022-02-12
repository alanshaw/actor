import { assert } from "chai"
import * as Task from "../src/lib.js"

describe("wait", () => {
  it("does sync wait on non-promise", async () => {
    let isSync = true
    const promise = inspect(function* () {
      const message = yield* Task.wait(5)
      assert.equal(isSync, true, "expect to be sync")
      return message
    })
    isSync = false
    const result = await promise

    assert.deepEqual(result, { ok: true, value: 5, mail: [] })
  })

  it("does await on promise", async () => {
    let isSync = true
    const promise = inspect(function* () {
      const message = yield* Task.wait(Promise.resolve(5))
      assert.equal(isSync, false, "expect to be async")
      return message
    })
    isSync = false
    const result = await promise

    assert.deepEqual(result, {
      ok: true,
      value: 5,
      mail: [],
    })
  })

  it("does throw on yield", async () => {
    // @ts-expect-error - not a valid task
    const result = await inspect(function* () {
      yield 5
    })

    assert.deepEqual(result.ok, false)
    assert.match(result.error.toString(), /Unknown instruction/g)
  })

  it("does throw on failed promise", async () => {
    const boom = new Error("boom!")
    const result = await inspect(function* () {
      const message = yield* Task.wait(Promise.reject(boom))
      return message
    })

    assert.deepEqual(result, {
      ok: false,
      mail: [],
      error: boom,
    })
  })

  it("can catch promise errors", async () => {
    const boom = new Error("boom!")
    const result = await inspect(function* () {
      try {
        const message = yield* Task.wait(Promise.reject(boom))
        return message
      } catch (error) {
        return error
      }
    })

    assert.deepEqual(result, {
      ok: true,
      mail: [],
      value: boom,
    })
  })

  it("can intercept thrown errors", async () => {
    const boom = new Error("boom!")
    const fail = () => {
      throw boom
    }

    const result = await inspect(function* () {
      fail()
    })

    assert.deepEqual(result, {
      ok: false,
      mail: [],
      error: boom,
    })
  })

  it("can catch thrown errors", async () => {
    const boom = new Error("boom!")
    const fail = () => {
      throw boom
    }

    const result = await inspect(function* () {
      try {
        fail()
      } catch (error) {
        return error
      }
    })

    assert.deepEqual(result, {
      ok: true,
      mail: [],
      value: boom,
    })
  })

  it("use finally", async () => {
    const boom = new Error("boom!")
    let finalized = false
    const result = await inspect(function* () {
      try {
        const message = yield* Task.wait(Promise.reject(boom))
        return message
      } finally {
        finalized = true
      }
    })

    assert.deepEqual(result, {
      ok: false,
      mail: [],
      error: boom,
    })

    assert.equal(finalized, true)
  })
})

describe("messaging", () => {
  it("can send message", async () => {
    const result = await inspect(function* () {
      yield* Task.send("one")
      yield* Task.send("two")
    })

    assert.deepEqual(result, {
      ok: true,
      value: undefined,
      mail: ["one", "two"],
    })
  })

  it("can send message in finally", async () => {
    const result = await inspect(function* () {
      try {
        yield* Task.send("one")
        yield* Task.send("two")
      } finally {
        yield* Task.send("three")
      }
    })

    assert.deepEqual(result, {
      ok: true,
      value: undefined,
      mail: ["one", "two", "three"],
    })
  })
  it("can send message after exception", async () => {
    const result = await inspect(function* () {
      try {
        yield* Task.send("one")
        yield* Task.send("two")
        // yield * Task.wait(Promise.reject('boom'))
        throw "boom"
        yield* Task.send("three")
      } finally {
        yield* Task.send("four")
      }
    })

    assert.deepEqual(result, {
      ok: false,
      error: "boom",
      mail: ["one", "two", "four"],
    })
  })

  it("can send message after rejected promise", async () => {
    const result = await inspect(function* () {
      try {
        yield* Task.send("one")
        yield* Task.send("two")
        yield* Task.wait(Promise.reject("boom"))
        yield* Task.send("three")
      } finally {
        yield* Task.send("four")
      }
    })

    assert.deepEqual(result, {
      ok: false,
      error: "boom",
      mail: ["one", "two", "four"],
    })
  })

  it("can send message after rejected promise", async () => {
    const result = await inspect(function* () {
      try {
        yield* Task.send("one")
        yield* Task.send("two")
        yield* Task.wait(Promise.reject("boom"))
        yield* Task.send("three")
      } finally {
        yield* Task.wait(Promise.reject("oops"))
        yield* Task.send("four")
      }
    })

    assert.deepEqual(result, {
      ok: false,
      error: "oops",
      mail: ["one", "two"],
    })
  })

  it("subtasks can send messages", async () => {
    function* child() {
      yield* Task.send("c1")
    }

    const result = await inspect(function* () {
      try {
        yield* Task.send("one")
        yield* Task.send("two")
        yield* child()
        yield* Task.send("three")
      } finally {
        yield* Task.send("four")
        yield* Task.wait(Promise.reject("oops"))
        yield* Task.send("five")
      }
    })

    assert.deepEqual(result, {
      ok: false,
      error: "oops",
      mail: ["one", "two", "c1", "three", "four"],
    })
  })
})

describe("subtasks", () => {
  it("crashes parent", async () => {
    /**
     * @param {Task.Await<number>} x
     * @param {Task.Await<number>} y
     */
    function* child(x, y) {
      return (yield* Task.wait(x)) + (yield* Task.wait(y))
    }

    const result = await inspect(function* () {
      const one = yield* child(1, 2)
      const two = yield* child(Promise.reject(5), one)
      return two
    })

    assert.deepEqual(result, {
      ok: false,
      error: 5,
      mail: [],
    })
  })

  it.skip("fork does not crash parent", async () => {
    /** @type {string[]} */
    const children = []
    /**
     * @param {string} id
     */
    function* child(id) {
      children.push(id)
      yield* Task.send(`${id}#1`)
      yield* Task.wait(Promise.reject("boom"))
      return 0
    }

    const result = await inspect(function* () {
      // @ts-expect-error - forked tasks can send messages
      yield* Task.fork(child("A"))
      yield* Task.wait(Promise.resolve("one"))
      // @ts-expect-error - forked tasks can send messages
      yield* Task.fork(child("B"))
      yield* Task.send("hi")
      return yield* Task.wait(Promise.resolve("two"))
    })

    assert.deepEqual(result, {
      ok: true,
      value: "two",
      mail: ["hi"],
    })
    assert.deepEqual(children, ["A", "B"])
  })

  it.skip("waiting on forks result crashes parent", async () => {
    /** @type {string[]} */
    const children = []
    /**
     * @param {string} id
     */
    function* child(id) {
      children.push(id)
      yield* Task.send(`${id}#1`)
      yield* Task.wait(Promise.reject(`${id}!boom`))
      return 0
    }

    const result = await inspect(function* () {
      // @ts-expect-error - forked tasks can send messages
      yield* Task.fork(child("A"))
      yield* Task.wait(Promise.resolve("one"))
      // @ts-expect-error - forked tasks can send messages
      const b = yield* Task.fork(child("B"))
      yield* Task.send("hi")
      yield* Task.wait(b.result)
      return yield* Task.wait(Promise.resolve("two"))
    })

    assert.deepEqual(result, {
      ok: false,
      error: "B!boom",
      mail: ["hi"],
    })
    assert.deepEqual(children, ["A", "B"])
  })
})

describe("concurrency", () => {
  it("can run tasks concurrently", async () => {
    /**
     * @param {string} name
     * @param {number} duration
     * @param {number} count
     */
    function* child(name, duration, count) {
      let n = 0
      while (n++ < count) {
        yield* Task.sleep(duration)
        yield* Task.send(`${name}#${n}`)
      }
    }

    function* parent() {
      yield* Task.spawn(child("a", 5, 6))
      yield* Task.sleep(5)
      yield* Task.spawn(child("b", 7, 7))

      yield* Task.join()
    }

    const result = await inspect(parent)
    const { mail } = result
    assert.deepEqual(
      [...mail].sort(),
      [
        "a#1",
        "a#2",
        "a#3",
        "a#4",
        "a#5",
        "a#6",
        "b#1",
        "b#2",
        "b#3",
        "b#4",
        "b#5",
        "b#6",
        "b#7",
      ],
      "has all the items"
    )
    assert.notDeepEqual([...mail].sort(), mail, "messages are not ordered")
  })

  it("can dot this", async () => {
    const log = ["Start"]
    /**
     * @param {string} name
     */
    function* worker(name) {
      log.push(`> ${name} sleep`)
      yield* Task.sleep(100)
      log.push(`< ${name} wake`)
    }

    function* actor() {
      log.push("Spawn A")
      yield* Task.spawn(worker("A"))

      log.push("Sleep")
      yield* Task.sleep(800)

      log.push("Spawn B")
      yield* Task.spawn(worker("B"))

      log.push("Join")
      yield* Task.join()

      log.push("Nap")
      yield* Task.sleep(0)

      log.push("Exit")
    }

    const result = await Task.promise(actor())

    assert.deepEqual(log, [
      "Start",
      "Spawn A",
      "Sleep",
      "> A sleep",
      "< A wake",
      "Spawn B",
      "Join",
      "> B sleep",
      "< B wake",
      "Nap",
      "Exit",
    ])
  })
})

/**
 * @template T, M, X
 * @param {() => Task.Task<T, M, X>} activate
 * @returns {Task.Await<{ ok: boolean, value?: T, error?: X, mail: M[] }>}
 */
const inspect = activate => {
  /**
   * @returns {Task.Task<{ ok: boolean, value?: T, error?: X, mail: M[] }, M, X>}
   */
  const inspector = function* () {
    /** @type {M[]} */
    const mail = []
    const task = activate()
    let input
    try {
      while (true) {
        const step = task.next(input)
        if (step.done) {
          return { ok: true, value: step.value, mail }
        } else {
          const instruction = step.value
          switch (instruction.type) {
            case "send":
              mail.push(instruction.message)
              input = yield instruction
              break
            case "self":
            case "suspend":
              input = yield instruction
              break
            default:
              input = yield instruction
              break
            // throw new Error(`Can not interpret ${JSON.stringify(input)}`)
          }
        }
      }
    } catch (error) {
      return { ok: false, error: /** @type {X} */ (error), mail }
    }
  }
  return Task.promise(inspector())

  // /** @type {M[]} */
  // const mail = []
  // return Task.execute(activate(), {
  //   send (message) {
  //     mail.push(message)
  //   },
  //   throw (error) {
  //     return { ok: false, error, mail }
  //   },
  //   return (value) {
  //     return { ok: true, value, mail }
  //   },

  //   /**
  //    * @param input
  //    * @returns {never}
  //    */
  //   interpret (input) {
  //     throw new Error(`Can not interpret ${JSON.stringify(input)}`)
  //   }
  // })
}
// describe('continuation', () => {
//   it('can raise errors', () => {
//     expect(() => evaluate(function * () {
//       yield * shift(function * (k) {
//         k.throw(new Error('boom!'))
//       })
//     })).to.throw('boom!')
//   })

//   it('can catch errors', () => {
//     expect(evaluate(function * () {
//       try {
//         yield * shift(function * (k) {
//           return k.throw(new Error('boom!'))
//         })
//         return 'did not throw'
//       } catch (error) {
//         return Object(error).message
//       }
//     })).to.equal('boom!')
//   })

//   it('allows you to return', () => {
//     expect(evaluate(function * () {
//       yield * shift(function * (k) {
//         return k.return('hello')
//       })
//     })).to.equal('hello')
//   })
// })

// describe('capture', () => {
//   it('can capture completed operations', () => {
//     expect(evaluate(() => capture(function * () { return 5 })))
//       .to.deep.equal({ ok: true, value: 5 })
//   })

//   it('can capture errored operations', () => {
//     const boom = new Error('boom')
//     const task = capture(function * () { throw boom })
//     const result = evaluate(() => task)

//     expect(result)
//       .to.deep.equal({ ok: false, error: boom })
//   })
// })

// describe('sleep', () => {
//   it('can sleep', async () => {
//     const result = evaluate(function * () {
//       console.log('start')
//       const start = Date.now()
//       console.log('sleep')
//       yield * FX.sleep(500)
//       console.log('awake')
//       const end = Date.now()

//       console.log('done', { start, end })
//       return start - end
//     })

//     console.log(result)

//     await new Promise(() => {

//     })

//     expect(result).to.be.greaterThanOrEqual(500)
//   })
// })