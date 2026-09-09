declare module 'matter-js' {
  export interface Vector {
    x: number
    y: number
  }

  export interface Body {
    id: number
    label: string
    position: Vector
    velocity: Vector
    angle: number
    angularVelocity: number
    isSleeping: boolean
    isStatic: boolean
  }

  export interface Composite {
    bodies: Body[]
  }

  export interface Engine {
    world: Composite
    gravity: {
      x: number
      y: number
      scale: number
    }
    positionIterations: number
    velocityIterations: number
  }

  export interface CollisionPair {
    bodyA: Body
    bodyB: Body
    collision: {
      normal: Vector
    }
  }

  export interface CollisionEvent {
    pairs: CollisionPair[]
  }

  export interface BodyOptions {
    label?: string
    restitution?: number
    friction?: number
    frictionStatic?: number
    frictionAir?: number
    density?: number
    sleepThreshold?: number
  }

  export const Bodies: {
    circle(x: number, y: number, radius: number, options?: BodyOptions): Body
  }

  export const Body: {
    setAngle(body: Body, angle: number): void
    setPosition(body: Body, position: Vector): void
    setVelocity(body: Body, velocity: Vector): void
    setAngularVelocity(body: Body, velocity: number): void
    setStatic(body: Body, isStatic: boolean): void
  }

  export const Composite: {
    add(composite: Composite, body: Body | Body[]): Composite
    remove(composite: Composite, body: Body, deep?: boolean): Composite
    clear(composite: Composite, keepStatic: boolean, deep?: boolean): void
  }

  export const Engine: {
    create(options?: { enableSleeping?: boolean }): Engine
    update(engine: Engine, delta?: number): Engine
    clear(engine: Engine): void
  }

  export const Events: {
    on(
      object: Engine,
      eventNames: 'collisionStart',
      callback: (event: CollisionEvent) => void,
    ): void
    off(
      object: Engine,
      eventNames: 'collisionStart',
      callback: (event: CollisionEvent) => void,
    ): void
  }

  export const Sleeping: {
    set(body: Body, isSleeping: boolean): void
  }
}
