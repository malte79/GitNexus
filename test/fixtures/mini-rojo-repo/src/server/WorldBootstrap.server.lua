local ServerScriptService = game:GetService("ServerScriptService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local sharedRoot = ReplicatedStorage:WaitForChild("Shared")
local Log = require(sharedRoot:WaitForChild("Log"))
local WorldReady = require(ServerScriptService:WaitForChild("WorldReady"))

return function()
  Log.info("server")
  return WorldReady.markReady()
end
