local ReplicatedStorage = game:GetService("ReplicatedStorage")
local sharedRoot = ReplicatedStorage:WaitForChild("Shared")
local Log = require(sharedRoot:WaitForChild("Log"))
local UIService = require(script.Parent:WaitForChild("UI"):WaitForChild("UIService"))

return function()
  Log.info("boot")
  return UIService.render()
end
