Ext.define('CArABU.technicalservices.FeatureTaskStore',{
    logger: new Rally.technicalservices.Logger(),
    MAX_CHUNK_SIZE: 25,
    TASK_STATES: ['Defined','In-Progress','Completed'],

    load: function(records){
        var deferred = Ext.create('Deft.Deferred');

        var objectIDs = _.map(records, function(r){ return r.get('ObjectID'); });

        this.logger.log('CArABU.technicalservices.FeatureTaskStore.load objectIDs', objectIDs);
        var promises = [];
        for (var i=0; i < objectIDs.length; i = i+this.MAX_CHUNK_SIZE){
            var chunk = Ext.Array.slice(objectIDs, i, i + this.MAX_CHUNK_SIZE);
            promises.push(this._fetchLBAPIChunk(chunk));
        }

        Deft.Promise.all(promises).then({
            success: function(results){
                this.logger.log('load Success', results);
                var totals = this._calculateTaskRollups(_.flatten(results), records, objectIDs);

                deferred.resolve(totals);
            },
            failure: function(msg){
                this.logger.log('load Failure', msg);
            },
            scope: this
        });

        return deferred;

    },
    _calculateTaskRollups: function(taskRecords, featureRecords, objectIDs){
        this.logger.log('_calculateTaskRollups', taskRecords, featureRecords);

        var snapsByOid = this._getSnapsByOid(taskRecords, objectIDs),
            totalToDo = [0,0,0],
            totalEstimate = [0,0,0],
            totalCount = [0,0,0],
            rollupsByOid = {};

        Ext.Array.each(featureRecords, function(r){
            var snaps = snapsByOid[r.get('ObjectID')] || null;
                //rollup = this._calculateRollup(snaps);

            var rollup = null;
            if (snaps && snaps.length > 0){

                rollup = {
                    taskCount: [0,0,0],
                    taskEstimate: [0,0,0],
                    taskToDo: [0,0,0],
                    count: {},
                    estimate: {},
                    todo: {}
                };

                for (var i=0; i<snaps.length; i++){
                    var snap = snaps[i],
                        state = snap.State,
                        stateIdx = _.indexOf(this.TASK_STATES, state);

                    rollup.taskCount[stateIdx]++;
                    rollup.taskEstimate[stateIdx] += (snap.Estimate || 0);
                    rollup.taskToDo[stateIdx] += (snap.ToDo || 0);

                    if (!rollup.count[state]){
                        rollup.count[state] = 0;
                        rollup.estimate[state] = 0;
                        rollup.todo[state] = 0;
                    }

                    rollup.count[state]++;
                    rollup.estimate[state] += (snap.Estimate || 0);
                    rollup.todo[state] += (snap.ToDo || 0)
                }

                for (var i=0; i < this.TASK_STATES.length; i++){
                    totalToDo[i] += rollup.taskToDo[i];
                    totalEstimate[i] += rollup.taskEstimate[i];
                    totalCount[i]+= rollup.taskCount[i];
                }
            }
            this.logger.log('_calculateRollup', r.get('FormattedID'), rollup);
            rollupsByOid[r.get('ObjectID')] = rollup;
        }, this);
        this.logger.log('_calculateRollup totals (ToDo, Estimate, Count)', totalToDo, totalEstimate, totalCount);
        var totals = {taskToDo: totalToDo, taskEstimate: totalEstimate, taskCount: totalCount};

        Ext.Array.each(featureRecords, function(r){
            var rollup = rollupsByOid[r.get('ObjectID')] || null;
            if (rollup){
                rollup.totals = totals;
            }
            r.set('rollup', rollup);
        });

        return totals;

    },
    _calculateRollup: function(snaps){

        var rollup = null;
        if (snaps && snaps.length > 0){

            rollup = {
                taskCount: [0,0,0],
                taskEstimate: [0,0,0],
                taskToDo: [0,0,0],
                count: {},
                estimate: {},
                todo: {}
            };

            for (var i=0; i<snaps.length; i++){
                var snap = snaps[i],
                    state = snap.State,
                    stateIdx = _.indexOf(this.TASK_STATES, state);

                rollup.taskCount[stateIdx]++;
                rollup.taskEstimate[stateIdx] += (snap.Estimate || 0);
                rollup.taskToDo[stateIdx] += (snap.ToDo || 0)

                if (!rollup.count[state]){
                    rollup.count[state] = 0;
                    rollup.estimate[state] = 0;
                    rollup.todo[state] = 0;
                }

                rollup.count[state]++;
                rollup.estimate[state] += (snap.Estimate || 0);
                rollup.todo[state] += (snap.ToDo || 0)
            }
        }
        this.logger.log('_calculateRollup', rollup);
        return rollup;

    },
    _getSnapsByOid: function(snapshots, featureObjectIDs){
        var hash = {};
        for (var i=0; i< snapshots.length; i++){
            var itemHierarchy = snapshots[i].get('_ItemHierarchy'),
                objectID = Ext.Array.intersect(featureObjectIDs, itemHierarchy)[0];

            if (!hash[objectID]){
                hash[objectID] = [];
            }
            hash[objectID].push(snapshots[i].getData());
        }
        return hash;
    },
    _fetchLBAPIChunk: function(objectIDs){
        var deferred = Ext.create('Deft.Deferred');

        Ext.create('Rally.data.lookback.SnapshotStore',{
            fetch: this._getLBAPIFetchList(),
            filters: [
                {
                    property: '_ItemHierarchy',
                    operator: 'in',
                    value: objectIDs
                },{
                    property: '_TypeHierarchy',
                    value: 'Task'
                },{
                    property: '__At',
                    value: "current"
                }

            ],
            hydrate: ['State'],
            sorters: [{
                property: 'ObjectID',
                direction: 'ASC'
            }],
            compress: true,
            removeUnauthorizedSnapshots: true
        }).load({
            callback: function(records, operation, success){
                if (success){
                    deferred.resolve(records);
                } else {
                    var msg = "Failure loading snapshots for objectIDs: " + objectIDs.join(', ') + ":  " + operation.error.errors.join(',');
                    deferred.resolve(msg);
                }
            }
        });
        return deferred;
    },
    _fetchChunk: function(objectIDs){
        var deferred = Ext.create('Deft.Deferred');

        var filters = _.map(objectIDs, function(o){ return {
                property: "Feature.ObjectID",
                value: o
            }
        });
        filters = Rally.data.wsapi.Filter.or(filters);

        filters = filters.and({
            property: "Tasks.ObjectID",
            operator: '>',
            value: 0
        });

        Ext.create('Rally.data.wsapi.Store',{
            fetch: this._getFetchList(),
            filters: filters,
            model: 'HierarchicalRequirement'
        }).load({
            callback: function(records, operation, success){
                if (success){
                    deferred.resolve(records);
                } else {
                    var msg = "Failure loading records for objectIDs: " + objectIDs.join(', ') + ":  " + operation.error.errors.join(',');
                    deferred.resolve(msg);
                }
            }
        });
        return deferred;
    },
    _getFetchList: function(){
        return ['ObjectID','Feature','Tasks','State','Estimate','ToDo'];
    },
    _getLBAPIFetchList: function(){
        return ['ObjectID','State','Estimate','ToDo','_ItemHierarchy'];
    }

});