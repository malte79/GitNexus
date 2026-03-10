local ReplicatedStorage = game:GetService("ReplicatedStorage")
local sharedRoot = ReplicatedStorage:WaitForChild("Shared")
local Log = require(sharedRoot:WaitForChild("Log"))

local UIService = {}

function UIService.render()
  return Log.info("ui")
end

return UIService
