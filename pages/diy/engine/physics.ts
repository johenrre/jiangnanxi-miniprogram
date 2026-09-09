import {
  Bodies,
  Body,
  Composite,
  Engine,
  Events,
  Sleeping,
  type Body as MatterBody,
  type CollisionEvent,
  type Engine as MatterEngine,
} from 'matter-js'

import type { BeadPosition } from '@/pages/diy/model/types'

const FIXED_STEP_MS = 1000 / 60
const MAX_RELEASE_SPEED = 24
const MAX_INITIAL_SPEED = 48
// Keep only 20% of the original boundary rebound speed (0.56 * 20%).
const BOUNDARY_RESTITUTION = 0.112
const BEAD_LABEL_PREFIX = 'diy-bead:'
const BEAD_COLLISION_SPEED_THRESHOLD = 3
const BOUNDARY_COLLISION_SPEED_THRESHOLD = 3
const MAXIMUM_COLLISION_VOLUME = 0.8
const DRAG_COLLISION_VELOCITY_TRANSFER = 0.72
const DRAG_COLLISION_PENETRATION_TRANSFER = 0.12
const MAXIMUM_DRAG_TRANSFER_SPEED = 26
const DRAG_SEPARATION_PADDING = 0.25

export interface DiyPhysicsImpact {
  kind: 'bead' | 'boundary'
  key: string
  speed: number
  volume: number
}

export interface PhysicsBeadSeed {
  uid: string
  x: number
  y: number
  radius: number
  rotation?: number
  velocityX?: number
  velocityY?: number
}

export interface PhysicsPositionTarget {
  uid: string
  x: number
  y: number
  rotation: number
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function clampVelocity(value: number): number {
  return clamp(value, -MAX_RELEASE_SPEED, MAX_RELEASE_SPEED)
}

function createBody(seed: PhysicsBeadSeed): MatterBody {
  const body = Bodies.circle(seed.x, seed.y, seed.radius, {
    label: `${BEAD_LABEL_PREFIX}${seed.uid}`,
    restitution: 0.52,
    friction: 0,
    frictionStatic: 0,
    frictionAir: 0.022,
    density: 0.001,
    sleepThreshold: 38,
  })

  Body.setAngle(body, seed.rotation || 0)
  Body.setVelocity(body, {
    x: clamp(seed.velocityX || 0, -MAX_INITIAL_SPEED, MAX_INITIAL_SPEED),
    y: clamp(seed.velocityY || 0, -MAX_INITIAL_SPEED, MAX_INITIAL_SPEED),
  })
  return body
}

function getBodyUid(body: MatterBody): string {
  return body.label.startsWith(BEAD_LABEL_PREFIX)
    ? body.label.slice(BEAD_LABEL_PREFIX.length)
    : ''
}

export class LooseBraceletPhysics {
  private readonly engine: MatterEngine
  private readonly bodies = new Map<string, MatterBody>()
  private readonly radii = new Map<string, number>()
  private readonly pendingImpacts = new Map<string, DiyPhysicsImpact>()
  private dragContacts = new Set<string>()
  private nextDragContacts = new Set<string>()
  private draggedUid: string | null = null
  private dragVelocityX = 0
  private dragVelocityY = 0
  private centerX: number
  private centerY: number
  private trayRadius: number

  constructor(centerX: number, centerY: number, trayRadius: number) {
    this.centerX = centerX
    this.centerY = centerY
    this.trayRadius = trayRadius
    this.engine = Engine.create({ enableSleeping: true })
    this.engine.gravity.x = 0
    this.engine.gravity.y = 0
    this.engine.gravity.scale = 0
    this.engine.positionIterations = 6
    this.engine.velocityIterations = 4
    Events.on(this.engine, 'collisionStart', this.handleCollisionStart)
  }

  setTrayGeometry(centerX: number, centerY: number, trayRadius: number): void {
    this.centerX = centerX
    this.centerY = centerY
    this.trayRadius = trayRadius
    this.constrainBodiesToTray()
  }

  replaceBeads(seeds: PhysicsBeadSeed[]): void {
    Composite.clear(this.engine.world, false, true)
    this.bodies.clear()
    this.radii.clear()
    this.pendingImpacts.clear()
    this.dragContacts.clear()
    this.nextDragContacts.clear()
    this.draggedUid = null
    this.dragVelocityX = 0
    this.dragVelocityY = 0

    seeds.forEach((seed) => this.addBead(seed))
  }

  addBead(seed: PhysicsBeadSeed): void {
    this.removeBead(seed.uid)
    const body = createBody(seed)
    this.bodies.set(seed.uid, body)
    this.radii.set(seed.uid, seed.radius)
    Composite.add(this.engine.world, body)
    Sleeping.set(body, false)
  }

  removeBead(uid: string): void {
    const body = this.bodies.get(uid)
    if (!body) return

    Composite.remove(this.engine.world, body, true)
    this.bodies.delete(uid)
    this.radii.delete(uid)
    this.dragContacts.delete(uid)
    if (this.draggedUid === uid) {
      this.draggedUid = null
      this.dragVelocityX = 0
      this.dragVelocityY = 0
      this.dragContacts.clear()
      this.nextDragContacts.clear()
    }
  }

  beginDrag(uid: string): boolean {
    const body = this.bodies.get(uid)
    if (!body) return false

    this.draggedUid = uid
    this.dragVelocityX = 0
    this.dragVelocityY = 0
    this.dragContacts.clear()
    this.nextDragContacts.clear()
    Sleeping.set(body, false)
    Body.setStatic(body, true)
    return true
  }

  moveDraggedBead(
    uid: string,
    x: number,
    y: number,
    velocityX: number,
    velocityY: number,
  ): void {
    if (this.draggedUid !== uid) return
    const body = this.bodies.get(uid)
    if (!body) return

    const startX = body.position.x
    const startY = body.position.y
    this.dragVelocityX = clampVelocity(velocityX)
    this.dragVelocityY = clampVelocity(velocityY)
    Body.setPosition(body, { x, y })
    Body.setVelocity(body, { x: 0, y: 0 })
    Sleeping.set(body, false)
    this.resolveDraggedCollisions(body, startX, startY, x, y)
  }

  endDrag(uid: string, velocityX: number, velocityY: number): void {
    if (this.draggedUid !== uid) return
    const body = this.bodies.get(uid)
    this.draggedUid = null
    this.dragVelocityX = 0
    this.dragVelocityY = 0
    this.dragContacts.clear()
    this.nextDragContacts.clear()
    if (!body) return

    Body.setStatic(body, false)
    Body.setVelocity(body, {
      x: clampVelocity(velocityX),
      y: clampVelocity(velocityY),
    })
    Sleeping.set(body, false)
  }

  cancelDrag(): void {
    if (!this.draggedUid) return
    const body = this.bodies.get(this.draggedUid)
    this.draggedUid = null
    this.dragVelocityX = 0
    this.dragVelocityY = 0
    this.dragContacts.clear()
    this.nextDragContacts.clear()
    if (!body) return

    Body.setStatic(body, false)
    Body.setVelocity(body, { x: 0, y: 0 })
    Sleeping.set(body, false)
  }

  step(deltaMs = FIXED_STEP_MS): void {
    Engine.update(this.engine, deltaMs)
    this.constrainBodiesToTray()
  }

  wakeAll(): void {
    this.bodies.forEach((body) => Sleeping.set(body, false))
  }

  hasActiveMotion(): boolean {
    for (const [uid, body] of this.bodies) {
      // The dragged bead is static and receives its position from touch input.
      // Its presence alone must not keep an otherwise idle 60fps loop alive.
      if (uid === this.draggedUid) continue
      if (!body.isSleeping) return true
    }
    return false
  }

  getPositions(): BeadPosition[] {
    const positions: BeadPosition[] = []
    this.bodies.forEach((body, uid) => {
      positions.push({
        uid,
        x: body.position.x,
        y: body.position.y,
        rotation: body.angle,
        isSleeping: body.isSleeping,
      })
    })
    return positions
  }

  syncPositions(targets: PhysicsPositionTarget[]): void {
    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index]
      const body = this.bodies.get(target.uid)
      if (!body) continue
      target.x = body.position.x
      target.y = body.position.y
      target.rotation = body.angle
    }
  }

  drainImpacts(): DiyPhysicsImpact[] {
    if (this.pendingImpacts.size === 0) return []
    const impacts = Array.from(this.pendingImpacts.values())
    this.pendingImpacts.clear()
    return impacts
  }

  destroy(): void {
    this.cancelDrag()
    Events.off(this.engine, 'collisionStart', this.handleCollisionStart)
    Composite.clear(this.engine.world, false, true)
    Engine.clear(this.engine)
    this.bodies.clear()
    this.radii.clear()
    this.pendingImpacts.clear()
    this.dragContacts.clear()
    this.nextDragContacts.clear()
  }

  private readonly handleCollisionStart = (event: CollisionEvent): void => {
    event.pairs.forEach((pair) => {
      const leftUid = getBodyUid(pair.bodyA)
      const rightUid = getBodyUid(pair.bodyB)
      if (!leftUid || !rightUid) return

      // Matter sees the pointer-controlled body as static. Substitute the
      // sampled pointer velocity so collisions with a held bead still have
      // the correct impact strength.
      const leftVelocityX = leftUid === this.draggedUid
        ? this.dragVelocityX
        : pair.bodyA.velocity.x
      const leftVelocityY = leftUid === this.draggedUid
        ? this.dragVelocityY
        : pair.bodyA.velocity.y
      const rightVelocityX = rightUid === this.draggedUid
        ? this.dragVelocityX
        : pair.bodyB.velocity.x
      const rightVelocityY = rightUid === this.draggedUid
        ? this.dragVelocityY
        : pair.bodyB.velocity.y
      const relativeVelocityX = rightVelocityX - leftVelocityX
      const relativeVelocityY = rightVelocityY - leftVelocityY
      const normal = pair.collision.normal
      const impactSpeed = Math.abs(
        relativeVelocityX * normal.x + relativeVelocityY * normal.y,
      )
      if (impactSpeed <= BEAD_COLLISION_SPEED_THRESHOLD) return

      const pairKey = leftUid < rightUid
        ? `bead:${leftUid}:${rightUid}`
        : `bead:${rightUid}:${leftUid}`
      this.recordImpact({
        kind: 'bead',
        key: pairKey,
        speed: impactSpeed,
        volume: Math.min(MAXIMUM_COLLISION_VOLUME, impactSpeed * 0.1),
      })
    })
  }

  private resolveDraggedCollisions(
    draggedBody: MatterBody,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
  ): void {
    const draggedUid = this.draggedUid
    if (!draggedUid) return
    const draggedRadius = this.radii.get(draggedUid) || 0
    const movementX = endX - startX
    const movementY = endY - startY
    const movementSquared = movementX * movementX + movementY * movementY
    const nextContacts = this.nextDragContacts
    nextContacts.clear()

    this.bodies.forEach((otherBody, otherUid) => {
      if (otherUid === draggedUid) return
      const otherRadius = this.radii.get(otherUid) || 0
      const combinedRadius = draggedRadius + otherRadius
      if (combinedRadius <= 0) return

      const startOffsetX = startX - otherBody.position.x
      const startOffsetY = startY - otherBody.position.y
      const startDistanceSquared = startOffsetX * startOffsetX
        + startOffsetY * startOffsetY
      const radiusSquared = combinedRadius * combinedRadius
      let contactTime = -1

      if (startDistanceSquared <= radiusSquared) {
        contactTime = 0
      } else if (movementSquared > 0.0001) {
        const projection = startOffsetX * movementX + startOffsetY * movementY
        const discriminant = projection * projection
          - movementSquared * (startDistanceSquared - radiusSquared)
        if (discriminant >= 0) {
          const candidateTime = (-projection - Math.sqrt(discriminant)) / movementSquared
          if (candidateTime >= 0 && candidateTime <= 1) contactTime = candidateTime
        }
      }

      const finalOffsetX = otherBody.position.x - endX
      const finalOffsetY = otherBody.position.y - endY
      const finalDistanceSquared = finalOffsetX * finalOffsetX
        + finalOffsetY * finalOffsetY
      const finalOverlap = finalDistanceSquared < radiusSquared
      if (contactTime < 0 && !finalOverlap) return
      nextContacts.add(otherUid)

      const contactX = contactTime >= 0 ? startX + movementX * contactTime : endX
      const contactY = contactTime >= 0 ? startY + movementY * contactTime : endY
      let normalX = otherBody.position.x - contactX
      let normalY = otherBody.position.y - contactY
      let normalLength = Math.sqrt(normalX * normalX + normalY * normalY)
      if (normalLength < 0.001) {
        normalX = Math.abs(movementX) + Math.abs(movementY) > 0.001
          ? movementX
          : this.dragVelocityX
        normalY = Math.abs(movementX) + Math.abs(movementY) > 0.001
          ? movementY
          : this.dragVelocityY
        normalLength = Math.max(0.001, Math.sqrt(normalX * normalX + normalY * normalY))
      }
      normalX /= normalLength
      normalY /= normalLength

      if (finalOverlap) {
        // Separate along the incoming collision normal. Using the final overlap
        // direction would pull a bead backwards after a fast pointer sweep.
        Body.setPosition(otherBody, {
          x: endX + normalX * (combinedRadius + DRAG_SEPARATION_PADDING),
          y: endY + normalY * (combinedRadius + DRAG_SEPARATION_PADDING),
        })
      }

      const relativeVelocityX = this.dragVelocityX - otherBody.velocity.x
      const relativeVelocityY = this.dragVelocityY - otherBody.velocity.y
      const closingSpeed = Math.max(
        0,
        relativeVelocityX * normalX + relativeVelocityY * normalY,
      )
      const finalPenetration = finalOverlap
        ? Math.max(0, combinedRadius - Math.sqrt(finalDistanceSquared))
        : 0
      const transferSpeed = Math.min(
        MAXIMUM_DRAG_TRANSFER_SPEED,
        closingSpeed * DRAG_COLLISION_VELOCITY_TRANSFER
          + finalPenetration * DRAG_COLLISION_PENETRATION_TRANSFER,
      )

      if (transferSpeed > 0.01) {
        Body.setVelocity(otherBody, {
          x: clamp(
            otherBody.velocity.x + normalX * transferSpeed,
            -MAX_INITIAL_SPEED,
            MAX_INITIAL_SPEED,
          ),
          y: clamp(
            otherBody.velocity.y + normalY * transferSpeed,
            -MAX_INITIAL_SPEED,
            MAX_INITIAL_SPEED,
          ),
        })
        const tangentSpeed = relativeVelocityY * normalX - relativeVelocityX * normalY
        Body.setAngularVelocity(
          otherBody,
          clamp(
            otherBody.angularVelocity + tangentSpeed / Math.max(8, otherRadius) * 0.08,
            -0.08,
            0.08,
          ),
        )
      }
      Sleeping.set(otherBody, false)

      if (
        !this.dragContacts.has(otherUid)
        && closingSpeed > BEAD_COLLISION_SPEED_THRESHOLD
      ) {
        const pairKey = draggedUid < otherUid
          ? `bead:${draggedUid}:${otherUid}`
          : `bead:${otherUid}:${draggedUid}`
        this.recordImpact({
          kind: 'bead',
          key: pairKey,
          speed: closingSpeed,
          volume: Math.min(MAXIMUM_COLLISION_VOLUME, closingSpeed * 0.1),
        })
      }
    })

    const previousContacts = this.dragContacts
    this.dragContacts = nextContacts
    this.nextDragContacts = previousContacts
    // Keep the static pointer-controlled body awake for a stable broad-phase update.
    Sleeping.set(draggedBody, false)
  }

  private recordImpact(impact: DiyPhysicsImpact): void {
    const existing = this.pendingImpacts.get(impact.key)
    if (!existing || impact.volume > existing.volume) {
      this.pendingImpacts.set(impact.key, impact)
    }
  }

  private constrainBodiesToTray(): void {
    for (const [uid, body] of this.bodies) {
      if (uid === this.draggedUid) continue

      const radius = this.radii.get(uid) || 0
      const maximumDistance = Math.max(0, this.trayRadius - radius)
      const offsetX = body.position.x - this.centerX
      const offsetY = body.position.y - this.centerY
      const distanceSquared = offsetX * offsetX + offsetY * offsetY

      if (distanceSquared <= maximumDistance * maximumDistance || distanceSquared === 0) {
        continue
      }

      const distance = Math.sqrt(distanceSquared)
      const normalX = offsetX / distance
      const normalY = offsetY / distance
      Body.setPosition(body, {
        x: this.centerX + normalX * maximumDistance,
        y: this.centerY + normalY * maximumDistance,
      })

      const normalVelocity = body.velocity.x * normalX + body.velocity.y * normalY
      if (normalVelocity > 0) {
        if (normalVelocity > BOUNDARY_COLLISION_SPEED_THRESHOLD) {
          this.recordImpact({
            kind: 'boundary',
            key: `boundary:${uid}`,
            speed: normalVelocity,
            volume: 0.4,
          })
        }
        Body.setVelocity(body, {
          x: body.velocity.x - (1 + BOUNDARY_RESTITUTION) * normalVelocity * normalX,
          y: body.velocity.y - (1 + BOUNDARY_RESTITUTION) * normalVelocity * normalY,
        })
      }
      Sleeping.set(body, false)
    }
  }
}
