var fs = require("fs"),
    csvToJson = require("csv-to-json"),
    Q = require("q");

var startingCapital = 0,
    rebalancingPercentageThreshold = 0.10,
    assets = {};

function getCurrentAssetWorth(assetName) {
    var asset = assets[assetName];
    return asset.currentPrice * asset.currentQty;
}

function getTotalWorth() {
    return Object.keys(assets).reduce(function (p, c) {
        var asset = assets[c];
        return p + asset.currentPrice * asset.currentQty;
    }, 0);
}

function getCurrentAssetAllocationPercentage(assetName) {
    return getCurrentAssetWorth(assetName) / getTotalWorth();
}

function getTotalYield() {
    return (getTotalWorth() - startingCapital) / startingCapital;
}

function initAllocation() {
    Object.keys(assets).forEach(function (name) {
        var asset = assets[name];
        asset.currentQty = asset.allocationPercentage * startingCapital / asset.currentPrice;
    });
}

function updatePrices(n) {
    Object.keys(assets).forEach(function(name) {
        var asset = assets[name];
        asset.currentPrice = asset.priceData ? asset.priceData[n].Close : 1;
    });
}

function printWorth() {
    var msg = Object.keys(assets).reduce(function(p, assetName) {
        return p + "\n" + assetName + ": " + getCurrentAssetWorth(assetName) + " (" + Math.round(100 * getCurrentAssetAllocationPercentage(assetName)) + "%)";
    }, "current worth:\n");

    console.log(msg);
    console.log("total: ", getTotalWorth(), " total yield: ", 100 * getTotalYield(), "%");
}

function rebalance() {
    Object.keys(assets).forEach(function (assetName) {
        var asset = assets[assetName],
            currAssetPercentage = getCurrentAssetAllocationPercentage(assetName),
            currAssetWorth = getCurrentAssetWorth(assetName),
            totalWorth = getTotalWorth();
        
        if (currAssetPercentage > asset.allocationPercentage + rebalancingPercentageThreshold) {
            console.log("--------------------------------");
            console.log("before rebalancing: ", assetName);
            printWorth();
            var totalSellWorth = currAssetWorth - asset.allocationPercentage * totalWorth;
            var assetSellQty = totalSellWorth / asset.currentPrice;
            asset.currentQty -= assetSellQty;
            
            var tempBalance = totalSellWorth;
            Object.keys(assets).forEach(function (otherAssetName) {
                if (otherAssetName != assetName) {
                    var otherAsset = assets[otherAssetName];
                    var diffAmt = otherAsset.allocationPercentage * totalWorth - otherAsset.currentPrice * otherAsset.currentQty;
                    diffAmt = Math.min(diffAmt, tempBalance);
                    if (diffAmt > 0) {
                        var diffQty = diffAmt / otherAsset.currentPrice;
                        tempBalance -= diffAmt;
                        otherAsset.currentQty += diffQty;
                    }
                }
            });
            
            console.log("\nafter rebalancing: ", assetName);
            printWorth();
            console.log("--------------------------------\n");
        }
    });
}

function loadFile(filename) {
    return Q.nfcall(csvToJson.parse, {
        filename: require('path').dirname(require.main.filename) + "/data/" + filename
    }).then(function(arr) {
        var chrono = arr.reverse();
        return chrono.filter(function (c) {
            return c.Close;
        }).map(function(c) {
            c.Close = parseFloat(c.Close);
            return c;
        });
    });
}

function loadPriceData() {
    var promises = Object.keys(assets).map(function(assetName) {
        return loadFile(assetName + ".csv");
    });

    return Q.allSettled(promises)
             .then(function(results) {
                var assetNames = Object.keys(assets);
                 results.forEach(function(data, i) {
                    var assetName = assetNames[i];
                     assets[assetName].priceData = data.value;
                 });
             }).catch( function(err) {
                 console.log("failed loading data", err);
             });
}

function loadCfg() {
    return Q.nfcall(fs.readFile, require('path').dirname(require.main.filename) + "/config/" + "config.json", 'utf8')
        .then(function(config) {
            var cfg = JSON.parse(config);
            startingCapital = cfg.startingCapital;
            rebalancingPercentageThreshold = cfg.rebalancingPercentageThreshold;
            Object.keys(cfg.allocations).forEach(function(name) {
                assets[name] = {};
                assets[name].currentQty = 0;
                assets[name].allocationPercentage = cfg.allocations[name];
            });
        });
}

function loadData() {
    return loadCfg().then(loadPriceData);
}

loadData().then(function () {
    updatePrices(0);

    initAllocation();
    
    var n = 1;

    var maxN = Object.keys(assets).reduce(function (p, c) {
        var asset = assets[c];
        return Math.max(p, asset.priceData ? asset.priceData.length : 0);
    }, 0);

    while (n < maxN) {
        updatePrices(n);
        
        rebalance();
        
        console.log("date: ", assets[Object.keys(assets)[0]].priceData[n].Date);
        
        n++;
        
        printWorth();
    }
}).catch (function(err) {
    console.log(err);
});