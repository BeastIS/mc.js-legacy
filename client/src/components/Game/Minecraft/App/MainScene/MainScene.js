import React, { Component } from 'react'
import { Mutation, Query, Subscription } from 'react-apollo'
import * as THREE from 'three'
import { withRouter } from 'react-router'

import Camera from '../Camera/Camera'
import Light from '../Light/Light'
import Player from '../Player/Player'
import Renderer from '../Renderer/Renderer'
import World from '../World/World'
import classes from './MainScene.module.css'
import { Hint } from '../../../../Utils'
import Config from '../../Data/Config'
import Helpers from '../../Utils/Helpers'
import {
  WORLD_QUERY,
  BLOCK_SUBSCRIPTION,
  UPDATE_PLAYER_MUTATION,
  MESSAGE_SUBSCRIPTION,
  PLAYER_SUBSCRIPTION
} from '../../../../../lib/graphql'
import ResourceManager from '../../Data/ResourceManager/ResourceManager'
import sharedStyles from '../../../../../containers/sharedStyles.module.css'
import Debug from '../Debug/Debug'

class MainScene extends Component {
  constructor(props) {
    super(props)

    this.initPos = null
    this.initDirs = null

    this.prevPos = {}
    this.prevDirs = {}

    this.updatePlayer = null

    // Load textures
    this.resourceManager = new ResourceManager()
    this.resourceManager.initialize()
  }

  handleQueryComplete = () => {
    // Prerequisites
    window.requestAnimationFrame =
      window.requestAnimationFrame ||
      window.mozRequestAnimationFrame ||
      window.webkitRequestAnimationFrame ||
      window.msRequestAnimationFrame ||
      (f => {
        return setTimeout(f, 1000 / 60)
      }) // simulate calling code 60

    window.cancelAnimationFrame =
      window.cancelAnimationFrame ||
      window.mozCancelAnimationFrame ||
      (requestID => {
        clearTimeout(requestID)
      }) //fall back

    /**
     * Behaves the same as setInterval except uses requestAnimationFrame() where possible for better performance
     * @param {function} fn The callback function
     * @param {int} delay The delay in milliseconds
     */
    window.requestInterval = function(fn, delay) {
      var start = performance.now(),
        handle = {}
      function loop() {
        handle.value = window.requestAnimationFrame(loop)
        var current = performance.now(),
          delta = current - start
        if (delta >= delay) {
          fn.call()
          start = performance.now()
        }
      }
      handle.value = window.requestAnimationFrame(loop)
      return handle
    }

    /**
     * Behaves the same as clearInterval except uses cancelRequestAnimationFrame() where possible for better performance
     * @param {int|object} fn The callback function
     */
    window.clearRequestInterval = function(handle) {
      window.cancelAnimationFrame
        ? window.cancelAnimationFrame(handle.value)
        : window.webkitCancelAnimationFrame
        ? window.webkitCancelAnimationFrame(handle.value)
        : window.webkitCancelRequestAnimationFrame
        ? window.webkitCancelRequestAnimationFrame(
            handle.value
          ) /* Support for legacy API */
        : window.mozCancelRequestAnimationFrame
        ? window.mozCancelRequestAnimationFrame(handle.value)
        : window.oCancelRequestAnimationFrame
        ? window.oCancelRequestAnimationFrame(handle.value)
        : window.msCancelRequestAnimationFrame
        ? window.msCancelRequestAnimationFrame(handle.value)
        : clearInterval(handle)
    }

    /**
     * Behaves the same as setTimeout except uses requestAnimationFrame() where possible for better performance
     * @param {function} fn The callback function
     * @param {int} delay The delay in milliseconds
     */

    window.requestTimeout = function(fn, delay) {
      if (
        !window.requestAnimationFrame &&
        !window.webkitRequestAnimationFrame &&
        !(
          window.mozRequestAnimationFrame &&
          window.mozCancelRequestAnimationFrame
        ) && // Firefox 5 ships without cancel support
        !window.oRequestAnimationFrame &&
        !window.msRequestAnimationFrame
      )
        return window.setTimeout(fn, delay)

      var start = performance.now(),
        handle = {}

      function loop() {
        var current = performance.now(),
          delta = current - start

        delta >= delay
          ? fn.call()
          : (handle.value = window.requestAnimationFrame(loop))
      }

      handle.value = window.requestAnimationFrame(loop)
      return handle
    }

    /**
     * Behaves the same as clearTimeout except uses cancelRequestAnimationFrame() where possible for better performance
     * @param {int|object} fn The callback function
     */
    window.clearRequestTimeout = function(handle) {
      window.cancelAnimationFrame
        ? window.cancelAnimationFrame(handle.value)
        : window.webkitCancelAnimationFrame
        ? window.webkitCancelAnimationFrame(handle.value)
        : window.webkitCancelRequestAnimationFrame
        ? window.webkitCancelRequestAnimationFrame(
            handle.value
          ) /* Support for legacy API */
        : window.mozCancelRequestAnimationFrame
        ? window.mozCancelRequestAnimationFrame(handle.value)
        : window.oCancelRequestAnimationFrame
        ? window.oCancelRequestAnimationFrame(handle.value)
        : window.msCancelRequestAnimationFrame
        ? window.msCancelRequestAnimationFrame(handle.value)
        : clearTimeout(handle)
    }

    // Player setup
    this.currentPlayer = this.worldData.players.find(
      ele => ele.user.username === this.props.username
    )
    this.initPos = {
      x: this.currentPlayer.x,
      y: this.currentPlayer.y,
      z: this.currentPlayer.z
    }
    this.initDirs = {
      dirx: this.currentPlayer.dirx,
      diry: this.currentPlayer.diry
    }

    // Main scene creation
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(Config.background.color)
    this.scene.fog = new THREE.Fog(
      Config.fog.color,
      Config.fog.near,
      Config.fog.far
    )

    // Main renderer constructor
    this.renderer = new Renderer(this.scene, this.mount)

    // Components instantiations
    this.camera = new Camera(this.renderer.threeRenderer)
    this.light = new Light(this.scene)
    // this.light.place('hemi')
    this.light.place('ambient')
    // this.light.place('point')

    // World Initialization
    this.world = new World(
      this.props.id,
      this.scene,
      this.worldData,
      this.client,
      this.resourceManager,
      this.mount,
      this.currentPlayer.id,
      this.currentPlayer.y - Number.MIN_SAFE_INTEGER <= 5
    )

    // Player initialization
    this.player = new Player(
      this.currentPlayer,
      this.camera.threeCamera,
      this.scene,
      this.world,
      this.mount,
      this.blocker,
      this.button,
      this.initPos,
      this.initDirs,
      this.resourceManager,
      this.currentPlayer.inventory,
      this.updatePlayer,
      this.world.chat
    )

    this.world.setPlayer(this.player)

    // Debug creation
    this.debug = new Debug(this.player, this.world)
    this.mount.appendChild(this.debug.getGui())
    this.player.controls.addDebugControl(this.debug)

    this.init()

    /** Called every 200ms to update player position with server. */
    this.updatePosCall = window.requestInterval(() => {
      const playerCoords = this.player.getCoordinates(),
        playerDirs = this.player.getDirections()

      // Making sure no values are null
      for (let member in playerCoords)
        if (playerCoords[member] !== 0 && !playerCoords[member]) return
      for (let member in playerDirs)
        if (playerDirs[member] !== 0 && !playerDirs[member]) return

      if (
        !(JSON.stringify(playerCoords) === JSON.stringify(this.prevPos)) ||
        !(JSON.stringify(playerDirs) === JSON.stringify(this.prevDirs))
      ) {
        this.prevPos = { ...playerCoords }
        this.prevDirs = { ...playerDirs }
        this.updatePlayer({
          variables: {
            id: this.currentPlayer.id,
            ...playerCoords,
            ...playerDirs
          }
        })
      }
    }, 200)

    // this.updateWorldCall = window.requestInterval(() => , 50)
  }

  componentDidMount() {
    window.addEventListener('beforeunload', this.closingHandler, false)
  }

  componentWillUnmount() {
    this.terminate()
    if (this.mount)
      this.mount.removeChild(this.renderer.threeRenderer.domElement)
    window.removeEventListener('beforeunload', this.closingHandler, false)
  }

  init = () => {
    window.addEventListener('resize', this.onWindowResize, false)
    if (!this.frameId) this.frameId = window.requestAnimationFrame(this.animate)
  }

  terminate = () => {
    window.cancelAnimationFrame(this.frameId)
    window.clearRequestInterval(this.updatePosCall)
    // window.clearRequestInterval(this.updateWorldCall)
  }

  animate = () => {
    this.update()
    this.updateWorld()
    this.debug.update()

    this.renderScene()
    if (!document.webkitHidden)
      this.frameId = window.requestAnimationFrame(this.animate)
  }

  update = () => {
    if (this.world.isReady) this.player.update()
  }

  renderScene = () => {
    this.renderer.render(this.scene, this.camera.threeCamera)
  }

  updateWorld = () => {
    const { coordx, coordy, coordz } = Helpers.toChunkCoords(
      this.player.getCoordinates()
    )

    this.world.requestMeshUpdate({
      coordx,
      coordy,
      coordz
    })
  }

  closingHandler = ev => {
    ev.preventDefault()
    ev.returnValue = 'Are you sure you want to close?'
  }

  onWindowResize = () => {
    this.camera.updateSize(this.renderer.threeRenderer)
    this.renderer.updateSize()
  }

  render() {
    const { id: worldId, history, username } = this.props

    return (
      <Query
        query={WORLD_QUERY}
        variables={{ query: worldId }}
        onError={err => console.error(err)}
        fetchPolicy="network-only"
        onCompleted={({ world }) => {
          this.worldData = world
          if (this.mount) this.handleQueryComplete()
          else this.waitingForMount = true
        }}
      >
        {({ loading, data }) => {
          if (loading) return <Hint text="Loading world..." />
          if (!data)
            return (
              <div className={classes.world_not_found}>
                <Hint text="World not found." />
                <button
                  className={sharedStyles.button}
                  onClick={() => history.push('/game/start')}
                >
                  Home
                </button>
              </div>
            )

          return (
            <>
              <Mutation
                mutation={UPDATE_PLAYER_MUTATION}
                onError={err => console.error(err)}
              >
                {(updatePlayer, { client }) => {
                  this.updatePlayer = updatePlayer // Hooked updatePlayer for outter usage
                  this.client = client

                  return (
                    <div
                      style={{
                        width: '100%',
                        height: '100%'
                      }}
                      ref={mount => {
                        this.mount = mount
                        if (this.waitingForMount) {
                          this.waitingForMount = false
                          this.handleQueryComplete()
                        }
                      }}
                    >
                      <div
                        className={classes.blocker}
                        ref={blocker => (this.blocker = blocker)}
                      >
                        <h1 className={classes.title}>Game Menu</h1>
                        <div className={classes.menu}>
                          <button
                            className={sharedStyles.button}
                            ref={button => (this.button = button)}
                          >
                            Back to Game
                          </button>
                          <button
                            className={sharedStyles.button}
                            onClick={() => history.push('/game/start')}
                          >
                            Save and Quit to Title
                          </button>
                        </div>
                      </div>
                      <img
                        src={this.resourceManager.getGuiImg('crosshair')}
                        alt=""
                        className={classes.crosshair}
                      />
                      <Subscription
                        subscription={BLOCK_SUBSCRIPTION}
                        variables={{ worldId }}
                        onSubscriptionData={({ subscriptionData: { data } }) =>
                          this.world.updateChanged(data)
                        }
                      />
                      <Subscription
                        subscription={MESSAGE_SUBSCRIPTION}
                        variables={{ worldId }}
                        onSubscriptionData={({ subscriptionData: { data } }) =>
                          this.world.chat.addMessage(data)
                        }
                      />
                      <Subscription
                        subscription={PLAYER_SUBSCRIPTION}
                        variables={{
                          username,
                          worldId,
                          updatedFields_contains_some: ['gamemode']
                        }}
                        onSubscriptionData={({ subscriptionData: { data } }) =>
                          this.player.handleUpdate(data)
                        }
                      />
                    </div>
                  )
                }}
              </Mutation>
            </>
          )
        }}
      </Query>
    )
  }
}

export default withRouter(MainScene)
